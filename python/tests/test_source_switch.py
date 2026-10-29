"""The `?source=` switch on /cfb/<id>/process and /nfl/<id>/process.

Game on Paper's 'source-switch' preview flag is the only caller that sends the
parameter, so the contract these tests hold is: a request WITHOUT it must be
exactly the request that exists today (no dispatch, no provenance, same bytes),
and a request WITH it must be validated against the sportsdataverse-py
contract's registry -- never against a list kept here, so `shield` starts
working when the pin moves and not a moment before.
"""

import base64
import importlib
from types import SimpleNamespace

import pytest

import live_qa
from tests.test_nfl_route import _FakeNFL


class _FakeCFB(_FakeNFL):
    """Same stand-in, under the CFB processor's fetch name."""

    def espn_cfb_pbp(self):
        self.fetched = True


@pytest.fixture(autouse=True)
def _fresh_live_state():
    # live_qa._STATE is module-global and `polls` is asserted absolutely below,
    # so any other test that tracked this game id would otherwise decide the
    # answer for this one.
    live_qa._STATE.clear()


@pytest.fixture
def app_mod(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as mod

    importlib.reload(mod)
    monkeypatch.setitem(mod._PROCESSORS, "nfl", (_FakeNFL, "espn_nfl_pbp"))
    monkeypatch.setitem(mod._PROCESSORS, "cfb", (_FakeCFB, "espn_cfb_pbp"))
    monkeypatch.setattr(mod.TEL, "push", lambda *a, **k: None)
    monkeypatch.setattr(mod, "_emit_dq", lambda *a, **k: None)
    return mod


@pytest.fixture
def client(app_mod):
    return app_mod.app.test_client()


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def _dispatch_stub(served, fallback):
    """Stands in for sportsdataverse.football.sources.dispatch._process_game."""

    def call(league, game_id, *, source):
        proc = _FakeNFL(gameId=game_id)
        proc.espn_nfl_pbp()
        game = proc.run_processing_pipeline()
        game["source"] = {"requested": source, "served": served, "fallback": fallback}
        return SimpleNamespace(
            processor=proc,
            game=game,
            provenance={"requested": source, "served": served, "fallback": fallback},
        )

    return call


# --- the default path is the old path ---------------------------------------

def test_no_source_param_never_reaches_the_dispatcher(client, app_mod, monkeypatch):
    def boom(*a, **k):  # pragma: no cover - the assertion is that it never runs
        raise AssertionError("the unflagged path must not go through dispatch")

    monkeypatch.setattr(app_mod, "_dispatch_game", boom)
    first = client.get("/nfl/401772944/process", headers=auth()).get_json()
    second = client.get("/nfl/401772944/process", headers=auth()).get_json()
    assert "provenance" not in first
    # and the payload is stable: nothing was appended non-deterministically
    # EXCEPT `qa`, whose live half counts this game's polls on purpose
    # (python/qa.py, docs/qa-payload.md) -- so it is compared separately.
    assert first.pop("qa")["live"]["polls"] == 1
    assert second.pop("qa")["live"]["polls"] == 2
    assert first == second


def test_source_espn_is_the_same_payload_plus_provenance(client, app_mod, monkeypatch):
    monkeypatch.setattr(app_mod, "_dispatch_game", None)  # espn never dispatches
    plain = client.get("/cfb/400869270/process", headers=auth()).get_json()
    stamped = client.get("/cfb/400869270/process?source=espn", headers=auth()).get_json()
    prov = stamped.pop("provenance")
    plain.pop("qa"), stamped.pop("qa")  # per-request by design; see above
    assert stamped == plain
    assert prov["source"] == "espn" and prov["requested"] == "espn"
    assert prov["fallback_used"] is False
    assert set(prov) == {"source", "requested", "fallback_used", "contract_version", "contract_sha"}


# --- validation -------------------------------------------------------------

@pytest.mark.parametrize("path", ["/cfb/400869270/process", "/nfl/401772944/process"])
def test_unknown_source_is_a_400_not_a_fallback(client, path):
    r = client.get(f"{path}?source=definitely-not-a-source", headers=auth())
    assert r.status_code == 400
    assert "unknown source" in r.get_json()["message"]


def test_a_source_the_pin_does_not_carry_is_also_a_400(client, app_mod, monkeypatch):
    # an older sportsdataverse-py has no contract at all -> ESPN only
    monkeypatch.setattr(app_mod, "_SOURCE_ORDER", {})
    monkeypatch.setattr(app_mod, "_dispatch_game", None)
    assert client.get("/nfl/1/process?source=shield", headers=auth()).status_code == 400
    assert client.get("/nfl/1/process?source=espn", headers=auth()).status_code == 200


# --- the dispatched path ----------------------------------------------------

def test_named_source_dispatches_and_stamps_provenance(client, app_mod, monkeypatch):
    monkeypatch.setattr(app_mod, "_SOURCE_ORDER", {"nfl": ("espn", "shield")})
    monkeypatch.setattr(app_mod, "_dispatch_game", _dispatch_stub("shield", False))
    body = client.get("/nfl/401772944/process?source=shield", headers=auth()).get_json()
    assert body["provenance"]["source"] == "shield"
    assert body["provenance"]["fallback_used"] is False
    assert len(body["plays"]) == 3  # the processor still ran, reshaped as usual
    assert body["plays"][0]["clock"]["displayValue"] == "1:00"


def test_espn_stays_the_terminal_fallback_and_says_so(client, app_mod, monkeypatch):
    monkeypatch.setattr(app_mod, "_SOURCE_ORDER", {"nfl": ("espn", "shield")})
    monkeypatch.setattr(app_mod, "_dispatch_game", _dispatch_stub("espn", True))
    body = client.get("/nfl/401772944/process?source=shield", headers=auth()).get_json()
    assert body["provenance"] == {
        "source": "espn",
        "requested": "shield",
        "fallback_used": True,
        "contract_version": app_mod._SDV_VERSION,
        "contract_sha": app_mod._SDV_SHA,
    }


def test_every_source_failing_is_a_404_not_a_500(client, app_mod, monkeypatch):
    # "no source has this game" is the same condition the ESPN path reports as
    # a clean 404. Answering 500 would write a stack trace to the error log on
    # every admin poke at an unmapped game id.
    from sportsdataverse.football.sources.dispatch import AllSourcesFailed

    def boom(league, game_id, *, source):
        raise AllSourcesFailed(league, game_id, {})

    monkeypatch.setattr(app_mod, "_SOURCE_ORDER", {"nfl": ("espn", "shield")})
    monkeypatch.setattr(app_mod, "_ALL_SOURCES_FAILED", AllSourcesFailed)
    monkeypatch.setattr(app_mod, "_dispatch_game", boom)
    logged = []
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: logged.append(a))
    r = client.get("/nfl/401772944/process?source=shield", headers=auth())
    assert r.status_code == 404
    assert r.get_json()["status"] == "bad"
    assert logged == []  # not an error in this service; no stack trace row


def test_any_other_dispatch_error_is_still_a_500(client, app_mod, monkeypatch):
    # the 404 clause must not swallow a real bug in an adapter
    def boom(league, game_id, *, source):
        raise ValueError("adapter is broken")

    monkeypatch.setattr(app_mod, "_SOURCE_ORDER", {"nfl": ("espn", "shield")})
    monkeypatch.setattr(app_mod, "_dispatch_game", boom)
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: None)
    assert client.get("/nfl/401772944/process?source=shield", headers=auth()).status_code == 500


# --- the registry is the contract's, not ours -------------------------------

def test_allowed_sources_come_from_the_contract_registry(app_mod):
    dispatch = pytest.importorskip("sportsdataverse.football.sources.dispatch")
    assert app_mod._SOURCE_ORDER is dispatch.SOURCE_ORDER
    # nothing in app.py enumerates these; when the shield adapter lands in the
    # pinned sportsdataverse-py, ?source=shield is accepted with no GOP change
    assert "shield" in app_mod._SOURCE_ORDER["nfl"]
    assert app_mod._SOURCE_ORDER["nfl"][0] == "espn"
