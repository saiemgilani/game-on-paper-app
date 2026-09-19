"""The compact ``qa`` field the ``/process`` payload carries on every request.

Game on Paper has request telemetry but no data-quality signal, so a wrong
live page is invisible until someone looks. This is the signal: one small
block per response, logged with the route timing, which makes every request a
sample rather than something a separate job has to go and measure.

Two halves, and either may be absent:

* the **per-game gate** -- ``sportsdataverse.validation.validate_game``, the
  packaged invariant rules (sportsdataverse-py #553). A deploy whose pin
  predates it has no such module, which is the current production state, so
  the ImportError is the expected path and not an error: the gate fields read
  null and nothing else changes.
* the **live rules** -- :mod:`live_qa`, which need no sdv-py at all and run
  only while the game is in progress.

``qa`` is null only when NEITHER half could say anything (a finished game on a
pin without the gate). The full report is deliberately not attached: consumers
that want every finding call ``validate_game`` themselves; this is the thing
that has to be cheap enough to ship on every response and store on every row.
The shape is contract, documented in ``docs/qa-payload.md``.
"""

import logging

import live_qa

try:  # a pin older than sportsdataverse-py #553 has no validation package
    from sportsdataverse.validation import validate_game as _validate_game
except ImportError:  # pragma: no cover - depends on the deployed sdv-py pin
    _validate_game = None

#: Most findings surfaced per response, errors before warnings.
_TOP_RULES = 5


def _top_rules(report):
    out = [
        {"rule": f.rule_id, "n": f.n_rows, "severity": f.severity}
        for f in sorted(report.errors, key=lambda f: -f.n_rows)
        + sorted(report.warnings, key=lambda f: -f.n_rows)
    ]
    return out[:_TOP_RULES]


def _in_progress(header):
    status = ((((header or {}).get("competitions") or [{}])[0]).get("status") or {}).get("type") or {}
    return status.get("completed") is not True and status.get("state") != "pre"


def build(game, processed_game, league, game_id, provenance=None, sdv_version=None, sdv_sha=None):
    """The ``qa`` block for one processed game, or None when nothing can be said.

    Args:
        game: the processor instance (``plays_frame`` is what the gate reads).
        processed_game: the reshaped payload this response will carry.
        league: ``"cfb"`` or ``"nfl"``.
        game_id: ESPN event id.
        provenance: dispatch's provenance dict when the request named a source,
            else None (the ESPN path, which has no contract report).
        sdv_version: installed ``sportsdataverse`` version.
        sdv_sha: the sha the image recorded for it.
    """
    header = (getattr(game, "json", None) or {}).get("header") or processed_game.get("header") or {}
    contract = (provenance or {}).get("contract") or {}
    # The two halves are independent by contract, so a gate that raises must
    # not take the live half -- or the poll that the live half would have
    # remembered -- down with it. Dropping a poll from _STATE is worse than
    # losing one verdict: the NEXT poll then compares against a stale summary
    # and can report a prefix violation that never happened.
    report = None
    frame = getattr(game, "plays_frame", None)
    if _validate_game is not None and frame is not None:
        try:
            report = _validate_game(
                frame, league, header=header, source=(provenance or {}).get("served", "espn")
            )
        except Exception as exc:
            logging.getLogger("root").warning("qa gate failed for %s: %s", game_id, exc)
    live = live_qa.track(game_id, processed_game) if _in_progress(header) else None
    if report is None and live is None:
        return None
    ok = (report.ok if report is not None else True) and (live["ok"] if live else True)
    if contract.get("ok") is False:
        ok = False
    return {
        "ok": ok,
        "n_errors": len(report.errors) if report is not None else None,
        "n_warnings": len(report.warnings) if report is not None else None,
        "top_rules": _top_rules(report) if report is not None else [],
        "contract_ok": contract.get("ok"),
        "gop_ok": contract.get("gop_ok"),
        "provenance": {
            "source": (provenance or {}).get("served", "espn"),
            "requested": (provenance or {}).get("requested"),
            "fallback_used": bool((provenance or {}).get("fallback", False)),
            "sdv_version": sdv_version,
            "sdv_sha": sdv_sha,
        },
        "live": live,
    }


def telemetry_fields(qa):
    """The flat columns ``gop.request_log`` keeps for one response's ``qa``.

    Rule ids go in as an array so ``/admin/qa``'s per-rule histogram is one
    ``unnest`` rather than a second table; a live rule is named the way the
    gate's are, so the two share the histogram. BOTH live tiers go in -- the
    histogram is meant to show what the source did as well as what we got
    wrong, and ``qa_ok`` is what tells them apart.
    """
    if not qa:
        return {}
    live = qa.get("live") or {}
    rules = [r["rule"] for r in qa.get("top_rules") or []]
    rules += [f["rule"] for f in (live.get("findings") or [])]
    rules += [f["rule"] for f in (live.get("anomalies") or [])]
    return {
        "qa_ok": qa.get("ok"),
        "qa_errors": qa.get("n_errors"),
        "qa_warnings": qa.get("n_warnings"),
        "qa_source": (qa.get("provenance") or {}).get("source"),
        "qa_fallback": (qa.get("provenance") or {}).get("fallback_used"),
        "qa_rules": rules or None,
    }
