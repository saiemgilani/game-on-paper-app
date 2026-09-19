"""The `qa` field on the /process payload.

Three states have to hold, because all three are live today: the gate is
installed and speaks (sportsdataverse-py #553 merged), the pin predates it and
the gate is silent (production right now), and something inside it raises. None
of them may cost the response, and the first two must still carry the live
rules, which need no sdv-py at all.
"""

import base64
import importlib
from types import SimpleNamespace

import pytest

import live_qa
import qa
from tests.test_nfl_route import _FakeNFL


def _finding(rule_id, n, severity="error"):
    return SimpleNamespace(rule_id=rule_id, n_rows=n, severity=severity)


def _report(ok=True, errors=(), warnings=()):
    return SimpleNamespace(ok=ok, errors=list(errors), warnings=list(warnings))


def _header(completed=True, state="post"):
    return {
        "competitions": [
            {
                "status": {"period": 4, "displayClock": "0:00",
                           "type": {"name": "STATUS_FINAL", "state": state, "completed": completed}},
                "competitors": [{"homeAway": "home", "score": "21"},
                                {"homeAway": "away", "score": "17"}],
            }
        ]
    }


def _game(frame=object(), completed=True, state="post"):
    return SimpleNamespace(json={"header": _header(completed, state)}, plays_frame=frame)


def _payload(completed=True, state="post"):
    return {"header": _header(completed, state),
            "plays": [{"id": "1", "text": "a", "type": {"id": "5", "text": "Rush"},
                       "period": 4, "start": {}, "end": {}}]}


@pytest.fixture(autouse=True)
def _fresh_state():
    live_qa._STATE.clear()


# --- the gate is installed ---------------------------------------------------

def test_the_gate_is_summarised_not_copied(monkeypatch):
    report = _report(ok=False,
                     errors=[_finding("score.monotone", 3), _finding("ep.ep_range", 9)],
                     warnings=[_finding("wp.wpa_sums_to_result", 1, "warn")])
    monkeypatch.setattr(qa, "_validate_game", lambda *a, **k: report)
    block = qa.build(_game(), _payload(), "nfl", 401772944, sdv_version="0.1.3", sdv_sha="abc")
    assert block["ok"] is False
    assert (block["n_errors"], block["n_warnings"]) == (2, 1)
    # errors first, each by size, capped -- and no findings list, no samples
    assert [r["rule"] for r in block["top_rules"]] == [
        "ep.ep_range", "score.monotone", "wp.wpa_sums_to_result"]
    assert block["provenance"] == {"source": "espn", "requested": None, "fallback_used": False,
                                   "sdv_version": "0.1.3", "sdv_sha": "abc"}
    assert block["live"] is None  # the game is final


def test_top_rules_is_capped_at_five(monkeypatch):
    monkeypatch.setattr(qa, "_validate_game",
                        lambda *a, **k: _report(ok=False, errors=[_finding(f"r{i}", i) for i in range(9)]))
    assert len(qa.build(_game(), _payload(), "cfb", 1)["top_rules"]) == 5


def test_a_contract_failure_on_an_adapted_source_fails_the_block(monkeypatch):
    monkeypatch.setattr(qa, "_validate_game", lambda *a, **k: _report(ok=True))
    prov = {"served": "shield", "requested": "shield", "fallback": True,
            "contract": {"ok": False, "gop_ok": False}}
    block = qa.build(_game(), _payload(), "nfl", 1, provenance=prov)
    assert block["ok"] is False and block["contract_ok"] is False and block["gop_ok"] is False
    assert block["provenance"]["source"] == "shield" and block["provenance"]["fallback_used"] is True


# --- the gate is not installed ----------------------------------------------

def test_no_validation_package_and_a_final_game_means_no_qa_at_all(monkeypatch):
    monkeypatch.setattr(qa, "_validate_game", None)
    assert qa.build(_game(), _payload(), "cfb", 1) is None


def test_no_validation_package_still_reports_the_live_rules(monkeypatch):
    monkeypatch.setattr(qa, "_validate_game", None)
    block = qa.build(_game(completed=False, state="in"), _payload(completed=False, state="in"), "cfb", 1)
    assert block is not None
    assert (block["n_errors"], block["n_warnings"], block["top_rules"]) == (None, None, [])
    assert block["live"]["polls"] == 1 and block["live"]["ok"] is True


def test_a_frameless_processor_skips_the_gate(monkeypatch):
    monkeypatch.setattr(qa, "_validate_game", lambda *a, **k: pytest.fail("no frame, no gate"))
    assert qa.build(_game(frame=None), _payload(), "cfb", 1) is None


# --- telemetry ---------------------------------------------------------------

def test_telemetry_fields_flatten_gate_and_live_rules_into_one_vocabulary(monkeypatch):
    monkeypatch.setattr(qa, "_validate_game",
                        lambda *a, **k: _report(ok=False, errors=[_finding("score.monotone", 3)]))
    block = qa.build(_game(completed=False, state="in"), _payload(completed=False, state="in"), "nfl", 7)
    block["live"]["findings"] = [{"rule": "live.score_monotone", "n": 1, "sample": "home 7 -> 3"}]
    row = qa.telemetry_fields(block)
    assert row["qa_ok"] is False and row["qa_errors"] == 1 and row["qa_source"] == "espn"
    assert row["qa_rules"] == ["score.monotone", "live.score_monotone"]
    assert qa.telemetry_fields(None) == {}


# --- through the route -------------------------------------------------------

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    monkeypatch.setitem(app_mod._PROCESSORS, "nfl", (_FakeNFL, "espn_nfl_pbp"))
    monkeypatch.setattr(app_mod.TEL, "push", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod.app.test_client()


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def test_the_route_carries_the_live_half_on_a_pin_without_the_gate(client):
    # _FakeNFL exposes no plays_frame (so no gate) and its status says the game
    # is not completed -- production's shape today, and the reason `qa` is not
    # simply null whenever the gate is missing.
    body = client.get("/nfl/401772944/process", headers=auth()).get_json()
    assert body["qa"]["n_errors"] is None and body["qa"]["live"]["polls"] == 1


class _FinalNFL(_FakeNFL):
    """The same stand-in for a game that has finished."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.json = {"header": _header(completed=True)}


def test_the_route_carries_an_explicit_null_when_nothing_can_be_said(client, monkeypatch):
    import app as app_mod

    monkeypatch.setattr(qa, "_validate_game", None)
    monkeypatch.setitem(app_mod._PROCESSORS, "nfl", (_FinalNFL, "espn_nfl_pbp"))
    body = client.get("/nfl/401772944/process", headers=auth()).get_json()
    assert "qa" in body and body["qa"] is None  # present, not absent


def test_a_raising_gate_costs_the_response_nothing(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("polars said no")

    monkeypatch.setattr(qa, "build", boom)
    r = client.get("/nfl/401772944/process", headers=auth())
    assert r.status_code == 200 and r.get_json()["qa"] is None
