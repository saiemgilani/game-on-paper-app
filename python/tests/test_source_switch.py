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

from tests.test_nfl_route import _FakeNFL


class _FakeCFB(_FakeNFL):
    """Same stand-in, under the CFB processor's fetch name."""

    def espn_cfb_pbp(self):
        self.fetched = True


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
    r = client.get("/nfl/401772944/process", headers=auth())
    assert r.status_code == 200
    assert "provenance" not in r.get_json()
    # and the bytes are stable: nothing was appended non-deterministically
    assert r.data == client.get("/nfl/401772944/process", headers=auth()).data


def test_source_espn_is_the_same_payload_plus_provenance(client, app_mod, monkeypatch):
    monkeypatch.setattr(app_mod, "_dispatch_game", None)  # espn never dispatches
    plain = client.get("/cfb/400869270/process", headers=auth()).get_json()
    stamped = client.get("/cfb/400869270/process?source=espn", headers=auth()).get_json()
    prov = stamped.pop("provenance")
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


# --- the registry is the contract's, not ours -------------------------------

def test_allowed_sources_come_from_the_contract_registry(app_mod):
    dispatch = pytest.importorskip("sportsdataverse.football.sources.dispatch")
    assert app_mod._SOURCE_ORDER is dispatch.SOURCE_ORDER
    # nothing in app.py enumerates these; when the shield adapter lands in the
    # pinned sportsdataverse-py, ?source=shield is accepted with no GOP change
    assert "shield" in app_mod._SOURCE_ORDER["nfl"]
    assert app_mod._SOURCE_ORDER["nfl"][0] == "espn"
