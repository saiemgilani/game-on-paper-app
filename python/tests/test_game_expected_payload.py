"""BB-G33: /<league>/<id>/process carries sdv-py's BB-D40 expected points, priced against the league's shot cells.

The cells are real: the Data API's `{lg}/shot_quality_cells` read 2026-11-10 (fixtures/README.md), seeded into
shot_cells' cache, so no test reads the network (conftest.py fails one that tries).
"""

import gzip
import json
import pathlib
import time

import pytest

import shot_cells
from tests.test_game_splits_payload import GAMES, _body

FIX = pathlib.Path(__file__).parent / "fixtures"
# the Data API's game_team_expected rows of the same finals (2026-11-10), each scored as of its own game date
API = json.loads((FIX / "game_team_expected_api.json").read_text(encoding="utf-8"))
ZONES = ("rim", "short_mid", "midrange", "corner3", "above_break3")


def _cells(league):
    return shot_cells.cells_frame(
        json.loads(gzip.open(FIX / f"{league}_shot_quality_cells.json.gz").read())
    )


@pytest.mark.parametrize(("league", "gid", "band"), GAMES)
def test_each_side_carries_its_expected_points(monkeypatch, league, gid, band):
    shot_cells._cache[league] = (time.time(), _cells(league))
    body = _body(monkeypatch, league, gid)
    api = {r["team_id"]: r for r in API.get(league, [])}
    for ha in ("home", "away"):
        e, s = body["expected"][ha], body["splits"][ha]["team"]
        assert e["team_id"] == body["teams"][ha]["team_id"]
        # the same plays and possessions as the BB-D31 splits
        for k in ("fga", "fgm", "possessions", "points"):
            assert e[k] == s[k], k
        assert e["fast_break_poss"] == s["transition_poss"]
        assert e["second_chance_poss"] == s["second_chance_poss"]
        assert sum(e[f"{z}_fga"] for z in ZONES) + e["unlocated_fga"] == e["fga"]
        # priced: every attempt has an expectation, and the zones' points over expected add up to the game's
        assert e["xfg_pts"] is not None and 0.7 < e["xfg_pts"] / e["fg_pts"] < 1.3
        assert sum(e[f"{z}_poe"] for z in ZONES) == pytest.approx(e["poe"])
        assert 0.3 < e["xts_pct"] < 0.8 and e["xdrtg"] is not None
        if api:  # the finals the Data API has built: the counts are its, the expectation within the as-of window's drift
            a = api[e["team_id"]]
            for k in (
                "fga",
                "fgm",
                "possessions",
                "points",
                "fast_break_poss",
                "second_chance_poss",
                "rim_fga",
                "corner3_fga",
            ):
                assert e[k] == a[k], k
            assert e["xfg_pts"] == pytest.approx(a["xfg_pts"], rel=0.05)
    # each side's expected DRtg is the other's expected ORtg
    assert body["expected"]["home"]["xdrtg"] == pytest.approx(
        body["expected"]["away"]["xortg"]
    )


def test_no_cells_leaves_the_expected_columns_null(monkeypatch):
    body = _body(
        monkeypatch, "wnba", 401736325
    )  # conftest: no key, so no read and no cells
    e = body["expected"]["home"]
    assert (
        e["fga"] > 0
        and e["xfg_pts"] is None
        and e["poe"] is None
        and e["rim_xppp"] is None
    )


def test_league_shot_cells_reads_once_and_backs_off(monkeypatch):
    rows = json.loads(gzip.open(FIX / "wbb_shot_quality_cells.json.gz").read())
    calls = []
    monkeypatch.setenv("SDV_AUTH_TOKEN", "k")
    monkeypatch.setattr(
        shot_cells, "_get", lambda url, token: calls.append(url) or {"data": rows}
    )
    first = shot_cells.league_shot_cells("wbb", now=1000.0)
    assert first.height == len(rows) and first.columns == list(shot_cells.CELLS_SCHEMA)
    assert (
        shot_cells.league_shot_cells("wbb", now=1000.0 + shot_cells.CACHE_SECONDS - 1)
        is first
    )
    assert calls == [
        "https://data.sportsdataverse.org/v1/wbb/shot_quality_cells?limit=5000"
    ]
    # a failed read gives None, and is not retried until RETRY_SECONDS have passed
    monkeypatch.setattr(
        shot_cells,
        "_get",
        lambda url, token: calls.append(url) or (_ for _ in ()).throw(OSError("429")),
    )
    assert shot_cells.league_shot_cells("nba", now=0.0) is None
    assert shot_cells.league_shot_cells("nba", now=shot_cells.RETRY_SECONDS - 1) is None
    assert len(calls) == 2
    # a read at the cap is truncated: never priced from a partial table
    monkeypatch.setattr(
        shot_cells, "_get", lambda url, token: {"data": [rows[0]] * shot_cells.LIMIT}
    )
    assert shot_cells.league_shot_cells("mbb", now=0.0) is None
    # no key: no read at all
    monkeypatch.delenv("SDV_AUTH_TOKEN")
    monkeypatch.setattr(
        shot_cells, "_get", lambda url, token: pytest.fail("read without a key")
    )
    assert shot_cells.league_shot_cells("wnba", now=0.0) is None
