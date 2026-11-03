"""`?source=` and `/<league>/<id>/sources` on the basketball routes (BB-G20), as on football.

Same contract as tests/test_source_switch.py: no `source` is today's request exactly, a named
source is checked against sportsdataverse-py's basketball registry (never a list kept here), an
unknown one is a 400, nothing producing the game is a 404, and a served response says where it
came from. ESPN is the only registered source today, so the alternate here is a stand-in adapter
registered the way BB-D13's will be: through the registry, with no change to app.py.
"""

import pytest

from tests.test_basketball_route import AUTH, _app, _summary

dispatch = pytest.importorskip("sportsdataverse.basketball.sources.dispatch")

GAME = "/nba/401585607"


def _register_live(monkeypatch, adapter=None):
    """Make a `live` NBA source selectable exactly as sdv-py would: SOURCE_ORDER plus an adapter."""
    monkeypatch.setitem(dispatch.SOURCE_ORDER, "nba", ("espn", "live"))
    if adapter is None:

        def adapter(league, espn_id, ctx):
            # an adapter's output IS espn_nba_pbp(raw=True)'s shape; this one just borrows it
            # (download is patched to the real capture by _app)
            from sportsdataverse.nba.nba_pbp import espn_nba_pbp

            return dispatch.AdaptedGame(
                summary=espn_nba_pbp(espn_id, raw=True),
                native_ids={"live_game_id": "0022300001"},
            )

    monkeypatch.setitem(dispatch._ADAPTERS, ("nba", "live"), adapter)


def _never(*a, **k):  # pragma: no cover - the assertion is that it never runs
    raise AssertionError("this path must not go through dispatch")


# --- the default path is the old path ---------------------------------------


def test_no_source_param_never_reaches_the_dispatcher(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    monkeypatch.setattr(app_mod, "_bb_dispatch_game", _never)
    r = app_mod.app.test_client().get(f"{GAME}/process", headers=AUTH)
    assert r.status_code == 200
    assert "provenance" not in r.get_json()


def test_source_espn_is_the_same_payload_plus_provenance(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    monkeypatch.setattr(app_mod, "_bb_dispatch_game", _never)
    client = app_mod.app.test_client()
    plain = client.get(f"{GAME}/process", headers=AUTH).get_json()
    stamped = client.get(f"{GAME}/process?source=espn", headers=AUTH).get_json()
    prov = stamped.pop("provenance")
    assert stamped == plain
    assert prov == {
        "source": "espn",
        "requested": "espn",
        "fallback_used": False,
        "contract_version": app_mod._SDV_VERSION,
        "contract_sha": app_mod._SDV_SHA,
    }


# --- validation -------------------------------------------------------------


@pytest.mark.parametrize("league", ["nba", "wnba", "mbb", "wbb"])
def test_unknown_source_is_a_400_not_a_fallback(monkeypatch, league):
    app_mod = _app(monkeypatch, _summary())
    monkeypatch.setattr(app_mod, "_bb_dispatch_game", _never)
    r = app_mod.app.test_client().get(
        f"/{league}/401585607/process?source=definitely-not-a-source", headers=AUTH
    )
    assert r.status_code == 400
    assert "unknown source" in r.get_json()["message"]


def test_a_source_the_pin_does_not_carry_is_also_a_400(monkeypatch):
    # an older sportsdataverse-py has no basketball contract at all -> ESPN only
    app_mod = _app(monkeypatch, _summary())
    monkeypatch.setattr(app_mod, "_BB_SOURCE_ORDER", {})
    monkeypatch.setattr(app_mod, "_bb_dispatch_game", None)
    client = app_mod.app.test_client()
    assert client.get(f"{GAME}/process?source=live", headers=AUTH).status_code == 400
    assert client.get(f"{GAME}/process?source=espn", headers=AUTH).status_code == 200


def test_the_football_registry_does_not_leak_into_basketball(monkeypatch):
    # cfb's `ncaa` is a real football source; it must still be a 400 on a basketball route
    app_mod = _app(monkeypatch, _summary())
    monkeypatch.setattr(app_mod, "_SOURCE_ORDER", {"nba": ("espn", "ncaa")})
    assert (
        app_mod.app.test_client()
        .get(f"{GAME}/process?source=ncaa", headers=AUTH)
        .status_code
        == 400
    )


# --- the dispatched path (real sdv-py dispatch, stand-in adapter) -----------


def test_a_registered_source_dispatches_and_stamps_provenance(monkeypatch):
    pushes = []
    app_mod = _app(monkeypatch, _summary(), pushes=pushes)
    _register_live(monkeypatch)
    client = app_mod.app.test_client()
    plain = client.get(f"{GAME}/process", headers=AUTH).get_json()
    pushes.clear()
    r = client.get(f"{GAME}/process?source=live", headers=AUTH)
    assert r.status_code == 200
    body = r.get_json()
    assert body.pop("provenance") == {
        "source": "live",
        "requested": "live",
        "fallback_used": False,
        "contract_version": app_mod._SDV_VERSION,
        "contract_sha": app_mod._SDV_SHA,
    }
    # same summary in, same page out: the dispatched path builds the payload the ESPN path does
    assert body == plain
    assert body["regulation_periods"] == 4
    assert [row["target"] for kind, row in pushes if kind == "upstream_log"] == [
        "live_nba_pbp"
    ]


def test_espn_stays_the_terminal_fallback_and_says_so(monkeypatch):
    pushes = []
    app_mod = _app(monkeypatch, _summary(), pushes=pushes)

    def down(league, espn_id, ctx):
        raise dispatch.SourceUnavailable("cdn.nba.com timed out")

    _register_live(monkeypatch, down)
    r = app_mod.app.test_client().get(f"{GAME}/process?source=live", headers=AUTH)
    assert r.status_code == 200
    prov = r.get_json()["provenance"]
    assert (prov["source"], prov["requested"], prov["fallback_used"]) == (
        "espn",
        "live",
        True,
    )
    assert [row["target"] for kind, row in pushes if kind == "upstream_log"] == [
        "espn_nba_pbp"
    ]


def test_every_source_failing_is_a_404_not_a_500(monkeypatch):
    # no plays anywhere: the stand-in and ESPN both fail the contract. That is the condition the
    # ESPN path answers with a clean 404, so it must not write a stack trace to the error log.
    summary = _summary()
    summary["plays"] = []

    def no_plays(league, espn_id, ctx):
        return dispatch.AdaptedGame(summary=summary)

    app_mod = _app(monkeypatch, summary)
    _register_live(monkeypatch, no_plays)
    logged = []
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: logged.append(a))
    r = app_mod.app.test_client().get(f"{GAME}/process?source=live", headers=AUTH)
    assert r.status_code == 404
    assert r.get_json() == {
        "status": "bad",
        "message": "No source could produce this game.",
    }
    assert logged == []


def test_any_other_dispatch_error_is_still_a_500(monkeypatch):
    # the 404 clause must not swallow a real bug
    def boom(league, game_id, *, source):
        raise ValueError("dispatch is broken")

    app_mod = _app(monkeypatch, _summary())
    _register_live(monkeypatch)
    monkeypatch.setattr(app_mod, "_bb_dispatch_game", boom)
    assert (
        app_mod.app.test_client()
        .get(f"{GAME}/process?source=live", headers=AUTH)
        .status_code
        == 500
    )


# --- the registry is the contract's, not ours -------------------------------


def test_allowed_sources_come_from_the_contract_registry(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    assert app_mod._BB_SOURCE_ORDER is dispatch.SOURCE_ORDER
    for league in app_mod.BASKETBALL_PROCESSORS:
        assert app_mod._source_order(league) == tuple(dispatch.SOURCE_ORDER[league])
        assert app_mod._source_order(league)[0] == "espn"


# --- GET /<league>/<id>/sources ---------------------------------------------


@pytest.mark.parametrize("league", ["nba", "wnba", "mbb", "wbb"])
def test_sources_route_is_authenticated_like_process(monkeypatch, league):
    client = _app(monkeypatch, _summary()).app.test_client()
    assert client.get(f"/{league}/401585607/sources").status_code == 401


def test_sources_route_answers_the_registry_and_picks_up_a_new_source(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    client = app_mod.app.test_client()
    assert client.get(f"{GAME}/sources", headers=AUTH).get_json()["sources"] == ["espn"]
    _register_live(monkeypatch)
    body = client.get(f"{GAME}/sources", headers=AUTH).get_json()
    assert body == {
        "league": "nba",
        "game_id": 401585607,
        "sources": ["espn", "live"],
        "contract_version": app_mod._SDV_VERSION,
        "contract_sha": app_mod._SDV_SHA,
    }
    assert client.get("/wnba/401585607/sources", headers=AUTH).get_json()[
        "sources"
    ] == ["espn"]


def test_sources_route_without_the_contract_offers_espn_alone(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    monkeypatch.setattr(app_mod, "_BB_SOURCE_ORDER", {})
    assert app_mod.app.test_client().get(f"{GAME}/sources", headers=AUTH).get_json()[
        "sources"
    ] == ["espn"]


def test_sources_route_never_fetches_a_source(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    from sportsdataverse.nba import nba_pbp

    monkeypatch.setattr(nba_pbp, "download", _never)
    monkeypatch.setattr(app_mod, "_bb_dispatch_game", _never)
    assert (
        app_mod.app.test_client().get(f"{GAME}/sources", headers=AUTH).status_code
        == 200
    )


def test_every_listed_source_is_one_process_accepts(monkeypatch):
    app_mod = _app(monkeypatch, _summary())
    _register_live(monkeypatch)
    client = app_mod.app.test_client()
    for source in client.get(f"{GAME}/sources", headers=AUTH).get_json()["sources"]:
        assert (
            client.get(f"{GAME}/process?source={source}", headers=AUTH).status_code
            == 200
        )
    assert client.get(f"{GAME}/process?source=nope", headers=AUTH).status_code == 400
