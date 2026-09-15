"""The processed box score of a final game carries the usage / situational /
special-teams sections the game page renders (UsageBoxScore, SituationalSplits).

Drives the real ``NFLPlayProcess`` through ``/nfl/<id>/process`` offline: the
ESPN summary and the core play items for 401872922 (JAX at CLE, 2026, final)
are the fixtures sportsdataverse-py's own usage-box tests use
(``tests/nfl/fixtures``), vendored gzipped under ``tests/fixtures``. A supplied
``summary=`` plus ``participants=`` at construction is the processor's
documented no-network path.
"""

import base64
import gzip
import importlib
import json
import os
from pathlib import Path

import pytest
from sportsdataverse.football.play_participants import (
    athlete_lookup_from_summary,
    play_participants_from_items,
)
from sportsdataverse.football.usage_box import SECTIONS
from sportsdataverse.nfl import NFLPlayProcess

FIX = Path(__file__).parent / "fixtures"
GAME_ID = 401872922


def _load(name):
    with gzip.open(FIX / name, "rt", encoding="utf-8") as fh:
        return json.load(fh)


class _OfflineNFL(NFLPlayProcess):
    """NFLPlayProcess fed from the committed fixtures instead of ESPN."""

    def __init__(self, gameId=GAME_ID, **kwargs):
        self._summary = _load(f"nfl_summary_{gameId}.json.gz")
        items = _load(f"nfl_plays_{gameId}.json.gz")["items"]
        parts = play_participants_from_items(
            items, gameId, athlete_lookup=athlete_lookup_from_summary(self._summary)
        )
        super().__init__(gameId=gameId, participants=parts, **kwargs)

    def espn_nfl_pbp(self, summary=None, **kwargs):
        return super().espn_nfl_pbp(summary=self._summary, **kwargs)


def _auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


@pytest.fixture(scope="module")
def body():
    """One processed response for the module (the pipeline takes seconds).

    Module-scoped, so no ``monkeypatch``: the overrides are undone by hand."""
    prior_token = os.environ.get("PYTHON_HTTP_TOKEN")
    os.environ["PYTHON_HTTP_TOKEN"] = "secret"
    import app as app_mod

    importlib.reload(app_mod)
    saved = (app_mod._PROCESSORS["nfl"], app_mod.TEL.push, app_mod._emit_dq)
    app_mod._PROCESSORS["nfl"] = (_OfflineNFL, "espn_nfl_pbp")
    app_mod.TEL.push = lambda *a, **k: None
    app_mod._emit_dq = lambda *a, **k: None
    try:
        r = app_mod.app.test_client().get(f"/nfl/{GAME_ID}/process", headers=_auth())
        assert r.status_code == 200, r.get_data(as_text=True)[:300]
        yield r.get_json()
    finally:
        app_mod._PROCESSORS["nfl"], app_mod.TEL.push, app_mod._emit_dq = saved
        if prior_token is None:
            os.environ.pop("PYTHON_HTTP_TOKEN", None)
        else:
            os.environ["PYTHON_HTTP_TOKEN"] = prior_token


def test_final_game_is_final(body):
    assert body["header"]["competitions"][0]["status"]["type"]["completed"] is True


def test_box_score_carries_every_usage_section(body):
    box = body["advBoxScore"]
    for section in SECTIONS:
        assert section in box, section
    # the classic sections are still there alongside the new ones
    assert {"pass", "rush", "receiver", "team", "defensive"} <= set(box)


def test_player_usage_and_st_team_have_rows_for_both_teams(body):
    box = body["advBoxScore"]
    teams = {
        str(c["team"]["id"]) for c in body["header"]["competitions"][0]["competitors"]
    }
    assert len(teams) == 2

    assert {str(r["pos_team"]) for r in box["player_usage"]} == teams
    assert {str(r["pos_team"]) for r in box["st_team"]} == teams

    # the sections the page tables read all have real rows
    for section in (
        "position_group_usage",
        "tackles",
        "position_group_tackles",
        "team_usage",
        "drive_scripting",
    ):
        assert box[section], section
    assert box["st_kickers"] and box["st_punters"]


def test_player_usage_rows_carry_the_columns_the_page_reads(body):
    row = body["advBoxScore"]["player_usage"][0]
    for col in (
        "player_id",
        "player_name",
        "position_group",
        "target_share",
        "explosive_plays",
        "first_downs",
    ):
        assert col in row, col


def test_usage_sections_survive_a_span_box(body):
    # the in-place span swap rebuilds the box over a window; the usage
    # sections must ride along or the tables blank out on a Q1 view
    spans = body.get("advBoxScoreSpans") or {}
    assert "h1" in spans, sorted(spans)
    assert "player_usage" in spans["h1"] and "st_team" in spans["h1"]
    assert spans["h1"]["player_usage"]
