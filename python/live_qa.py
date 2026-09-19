"""Live-poll invariants: the failures that only exist while a game is running.

Every rule here is a statement about TWO consecutive polls of one game, or
about the top of the frame in a single poll. They are the class of bug nobody
can reproduce after the fact -- by the time the report arrives the transient
state is gone (``docs/game-state-fixtures.md``: ESPN served a payload 35 plays
and a touchdown OLDER than the one before it, and the ``score_decreased`` probe
fired on 18 of 24 captured FCS games, so this is routine rather than exotic).

:func:`validate_live` is pure. ``prev_summary`` is a digest :func:`summarize`
produced from an earlier poll of the same game; ``curr_payload`` is the
``/{league}/{id}/process`` response body, after ``app._reshape_records``.
:func:`track` is the stateful wrapper the route calls, and the state it keeps
is a bounded in-process dict -- see its docstring for what that costs.

Every rule carries a severity (:data:`SEVERITY`) and only the ``error`` tier
fails a poll, because most of what these rules catch is the SOURCE
misbehaving on a page that is otherwise fine: a source may legitimately revise
a finished play (Shield re-revises ~11 plays back, tagged by ESPN's
``modified`` stamp), and ESPN's own header runs its score, period and clock
backwards on a third to a half of captured games. Those are counted and
returned under ``anomalies``; ``findings`` holds only the rules that mean the
page we rendered is wrong.
"""

import threading
from collections import OrderedDict
from datetime import datetime, timezone
from hashlib import blake2b

#: Severity per rule, the way the packaged gate scopes its own
#: (``sportsdataverse.validation.RULE_SCOPE``). Only ``error`` fails a poll.
#:
#: The split is measured, not guessed. Swept over the 259 captured games in
#: ``fixtures/game-states`` (7,790 poll pairs): ESPN's own header decreased the
#: score in 114 games, decreased the period in 81 and increased the clock in
#: 157, and a regressed payload dropped finished plays in 170. Those are things
#: the SOURCE does, routinely, to a page that is otherwise fine -- scoring them
#: as errors put 226 of 259 games (87%) in the alert channel on day one and made
#: ``ok`` stop discriminating, which is the one thing it exists to do.
#:
#: So they are anomalies: counted, carried in ``anomalies``, alertable on their
#: own rate, and not a claim that the page is wrong. The errors are the rules
#: that only fire when what we RENDERED is broken -- 16 of 259 games (6.2%) on
#: the same sweep, all of them ``phase_order``. Full table in
#: ``docs/qa-payload.md``.
SEVERITY = {
    # the source rewrote history, or its header went backwards
    "live.prefix_revised": "info",   # ...and said so, via `modified`
    "live.prefix_changed": "warn",
    "live.prefix_dropped": "warn",
    "live.score_monotone": "warn",
    "live.period_monotone": "warn",
    "live.clock_monotone": "warn",
    # the page we served is wrong
    "live.phase_order": "error",
    "live.type_null": "error",
    "live.end_state_derived": "error",
    "live.wp_continuity": "error",
    "live.timeouts_increased": "error",
}

#: Games whose previous poll is remembered, oldest evicted first.
_MAX_TRACKED = 64

# ponytail: per-worker state. gunicorn runs several workers (and two threads
# each, and recycles them every ~400 requests), so `polls` counts the polls THIS
# worker saw since ITS last recycle, not the game's total, and a cross-poll rule
# only fires when consecutive polls land on the same worker. That is a sampling
# rate, not a correctness problem -- every finding is still a real pair of real
# polls -- and docs/qa-payload.md tells the poller so. Move to the Workers KV
# the Astro side already keeps (`gamestate:<id>`) only if the rate proves too
# thin to alert on. The lock is for the two threads, which share this dict.
_STATE: "OrderedDict[str, dict]" = OrderedDict()
_STATE_LOCK = threading.Lock()


def _digest(*parts):
    h = blake2b(digest_size=8)
    for p in parts:
        h.update(repr(p).encode("utf-8", "replace"))
    return h.hexdigest()


def _clock_seconds(text):
    """ESPN's ``"10:26"`` -> 626. None when it is not a clock."""
    try:
        mins, _, secs = str(text).partition(":")
        return int(mins) * 60 + int(secs)
    except (TypeError, ValueError):
        return None


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def _half(period):
    """1 = Q1-Q2, 2 = Q3-Q4, 3+ = each overtime. Timeouts reset at each boundary."""
    if not isinstance(period, int) or period < 1:
        return None
    return 1 if period <= 2 else (2 if period <= 4 else period - 2)


def _status(payload):
    """``(status, competition)``. ESPN keeps ``period`` and ``displayClock`` on
    the status and the phase on ``status.type.state`` -- two levels, one call."""
    comp = ((payload.get("header") or {}).get("competitions") or [{}])[0]
    return (comp.get("status") or {}), comp


def _scores(comp):
    sides = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    return (
        _num((sides.get("home") or {}).get("score")),
        _num((sides.get("away") or {}).get("score")),
    )


# ESPN always sends `state`; the name is the belt-and-braces path for an
# adapted summary whose source only carries the status name.
_STATE_FROM_NAME = {
    "STATUS_SCHEDULED": "pre",
    "STATUS_IN_PROGRESS": "in",
    "STATUS_HALFTIME": "in",
    "STATUS_END_PERIOD": "in",
    "STATUS_DELAYED": "in",
    "STATUS_FINAL": "post",
}
_PHASE_RANK = {"pre": 0, "in": 1, "post": 2}


def summarize(payload):
    """The digest of one poll that the next poll's rules compare against.

    Small on purpose (a few KB for a full game): per play a content hash, the
    win probabilities the continuity rule needs kept OUT of that hash, and the
    source's own revision stamp.
    """
    status, comp = _status(payload)
    stype = status.get("type") or {}
    plays = payload.get("plays") or []
    home, away = _scores(comp)
    last = plays[-1] if plays else {}
    period = status.get("period")
    if not isinstance(period, int):
        period = last.get("period")
    rows = {}
    for p in plays[:-1]:  # the last row is still being amended; not yet finished
        pid = p.get("id")
        if pid is None:
            continue
        start, end = p.get("start") or {}, p.get("end") or {}
        rows[str(pid)] = {
            "d": _digest(
                p.get("text"), (p.get("type") or {}).get("id"), p.get("statYardage"),
                p.get("scoringPlay"), start.get("down"), start.get("distance"),
                start.get("yardsToEndzone"), start.get("homeScore"), start.get("awayScore"),
                end.get("down"), end.get("distance"), end.get("yardsToEndzone"),
                end.get("homeScore"), end.get("awayScore"),
            ),
            "wp": (_num(p.get("wp_before")), _num(p.get("wp_after"))),
            "m": p.get("modified"),
        }
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "state": stype.get("state") or _STATE_FROM_NAME.get(stype.get("name")),
        "period": period if isinstance(period, int) else None,
        "clock_s": _clock_seconds(status.get("displayClock") or (last.get("clock") or {}).get("displayValue")),
        "home": home if home is not None else _num((last.get("end") or {}).get("homeScore")),
        "away": away if away is not None else _num((last.get("end") or {}).get("awayScore")),
        "timeouts": (
            _num(last.get("start.homeTeamTimeouts")),
            _num(last.get("start.awayTeamTimeouts")),
        ),
        "n_plays": len(plays),
        "rows": rows,
    }


def validate_live(prev_summary, curr_payload):
    """Score one poll against the poll before it.

    Args:
        prev_summary: :func:`summarize` of an earlier poll of the same game, or
            None for the first poll (only the single-poll rules then run).
        curr_payload: the ``/process`` response body for this poll.

    Returns:
        ``{"ok", "findings", "anomalies"}``. Both lists hold
        ``{rule, n, sample, severity}``; ``findings`` is the ``error`` tier and
        ``anomalies`` the rest (see :data:`SEVERITY`), and ``ok`` is False when
        ``findings`` is non-empty. Nothing is discarded -- an anomaly is
        reported, it just does not claim the page is wrong.
    """
    curr = summarize(curr_payload)
    plays = curr_payload.get("plays") or []
    findings = []

    anomalies = []

    def fire(rule, n, sample):
        severity = SEVERITY[rule]
        entry = {"rule": rule, "n": n, "sample": sample, "severity": severity}
        (findings if severity == "error" else anomalies).append(entry)

    # --- single-poll rules ---------------------------------------------------
    # `id` and `text` only, deliberately: ESPN ships a null `type.abbreviation`
    # on play types that genuinely have none (type 29 "Fumble Recovery
    # (Opponent)" and friends -- 36 of 188 rows in the 401856682 capture), so
    # including it would fire on every healthy game. A null id or text is the
    # one that breaks the page: the play table groups and filters on them.
    nulls = [p.get("id") for p in plays
             if any((p.get("type") or {}).get(k) in (None, "") for k in ("id", "text"))]
    if nulls:
        fire("live.type_null", len(nulls), nulls[0])

    # The top row's end state must be DERIVED from the play, never a copy of
    # its own start: a live feed that has the play but not its result publishes
    # the two identical, and every downstream yardage reads zero.
    if plays:
        top = plays[-1]
        start, end = top.get("start") or {}, top.get("end") or {}
        moved = (_num(top.get("statYardage")) or 0.0) != 0.0 or top.get("scoringPlay") is True
        same = all(start.get(k) == end.get(k) for k in ("down", "distance", "yardsToEndzone"))
        if moved and same:
            fire("live.end_state_derived", 1, top.get("id"))

    if prev_summary:
        # --- prefix invariant ------------------------------------------------
        changed, revised = [], 0
        for pid, now in curr["rows"].items():
            was = (prev_summary.get("rows") or {}).get(pid)
            if was is None or was["d"] == now["d"]:
                continue
            if was.get("m") != now.get("m"):  # the source tagged this one revised
                revised += 1
            else:
                changed.append(pid)
        if changed:
            fire("live.prefix_changed", len(changed), changed[0])
        if revised:
            fire("live.prefix_revised", revised, None)
        # The other half of the invariant, and the one the captures actually
        # caught: a finished play that simply is not there any more. ESPN's
        # regressed payload for 401866532 dropped 29 rows and a touchdown
        # rather than rewriting anything, so a "changed" test alone saw nothing.
        dropped = [pid for pid in (prev_summary.get("rows") or {}) if pid not in curr["rows"]]
        if dropped:
            fire("live.prefix_dropped", len(dropped), dropped[0])

        # --- win probability on rows that did not change ---------------------
        moved_wp = [pid for pid, now in curr["rows"].items()
                    if (was := (prev_summary.get("rows") or {}).get(pid)) is not None
                    and was["d"] == now["d"] and tuple(was["wp"]) != tuple(now["wp"])
                    and None not in was["wp"] and None not in now["wp"]]
        if moved_wp:
            fire("live.wp_continuity", len(moved_wp), moved_wp[0])

        # --- clock, period, phase, score -------------------------------------
        p_prev, p_now = prev_summary.get("period"), curr.get("period")
        if isinstance(p_prev, int) and isinstance(p_now, int):
            if p_now < p_prev:
                fire("live.period_monotone", 1, f"{p_prev} -> {p_now}")
            elif p_now == p_prev:
                c_prev, c_now = prev_summary.get("clock_s"), curr.get("clock_s")
                if c_prev is not None and c_now is not None and c_now > c_prev:
                    fire("live.clock_monotone", 1, f"Q{p_now} {c_prev}s -> {c_now}s")

        r_prev = _PHASE_RANK.get(prev_summary.get("state"))
        r_now = _PHASE_RANK.get(curr.get("state"))
        if r_prev is not None and r_now is not None and r_now < r_prev:
            fire("live.phase_order", 1, f"{prev_summary.get('state')} -> {curr.get('state')}")

        for side in ("home", "away"):
            was, now = prev_summary.get(side), curr.get(side)
            if was is not None and now is not None and now < was:
                fire("live.score_monotone", 1, f"{side} {was:g} -> {now:g}")

        # --- timeouts --------------------------------------------------------
        if _half(p_prev) is not None and _half(p_prev) == _half(p_now):
            for i, side in enumerate(("home", "away")):
                was, now = prev_summary["timeouts"][i], curr["timeouts"][i]
                if was is not None and now is not None and now > was:
                    fire("live.timeouts_increased", 1, f"{side} {was:g} -> {now:g}")

    return {"ok": not findings, "findings": findings, "anomalies": anomalies}


def track(game_id, payload):
    """Validate this poll against the last one seen for ``game_id`` and remember it.

    Returns the ``qa.live`` block -- ``{ok, findings, anomalies, polls, since}``
    -- where ``polls`` and ``since`` describe this worker's view of the game
    (see the ``_STATE`` note). Never raises, and that has to include the
    bookkeeping: the read-modify-write below runs under ``_STATE_LOCK``, inside
    the guard, because two request threads share this dict and one of them
    evicting a key the other is about to touch must not reach the route.
    """
    key = str(game_id)
    try:
        with _STATE_LOCK:
            prev = _STATE.get(key)
        result = validate_live(prev and prev.get("summary"), payload)
        summary = summarize(payload)
        with _STATE_LOCK:
            polls = (prev or {}).get("polls", 0) + 1
            since = (prev or {}).get("since") or summary["ts"]
            _STATE[key] = {"summary": summary, "polls": polls, "since": since}
            _STATE.move_to_end(key)
            while len(_STATE) > _MAX_TRACKED:
                _STATE.popitem(last=False)
    except Exception:  # fail-open, same contract as every block on the route
        return None
    return {**result, "polls": polls, "since": since}
