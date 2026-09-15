"""The processed box score of a final game carries the usage / situational /
special-teams sections the game page renders (UsageBoxScore, SituationalSplits),
for both leagues.

Drives the real processors through ``/<league>/<id>/process`` offline, from
fixtures sportsdataverse-py's own tests use, vendored gzipped under
``tests/fixtures``:

- nfl: the ESPN summary and the core play items for 401872922 (JAX at CLE,
  2026, final). Play items become the per-play participants, so the tackle and
  position-group sections are populated too.
- cfb: the ESPN summary for 400869270 (OKST at CMU, 2016, final). No
  participants, so those sections are legitimately empty; the ball-carrier,
  team, drive-scripting and special-teams sections still come from the plays.

A supplied ``summary=`` is each processor's documented no-network path.
"""

import base64
import gzip
import importlib
import json
import os
from pathlib import Path

import pytest
from sportsdataverse.cfb import CFBPlayProcess
from sportsdataverse.football.play_participants import (
    athlete_lookup_from_summary,
    play_participants_from_items,
)
from sportsdataverse.football.usage_box import SECTIONS
from sportsdataverse.nfl import NFLPlayProcess

FIX = Path(__file__).parent / "fixtures"
GAMES = {"nfl": 401872922, "cfb": 400869270}
# sections that need ESPN's per-play participants (only the NFL fixture carries them)
PARTICIPANT_SECTIONS = ("position_group_usage", "tackles", "position_group_tackles")


def _load(name):
    with gzip.open(FIX / name, "rt", encoding="utf-8") as fh:
        return json.load(fh)


class _OfflineNFL(NFLPlayProcess):
    """NFLPlayProcess fed from the committed fixtures instead of ESPN."""

    def __init__(self, gameId=GAMES["nfl"], **kwargs):
        self._summary = _load(f"nfl_summary_{gameId}.json.gz")
        items = _load(f"nfl_plays_{gameId}.json.gz")["items"]
        parts = play_participants_from_items(
            items, gameId, athlete_lookup=athlete_lookup_from_summary(self._summary)
        )
        super().__init__(gameId=gameId, participants=parts, **kwargs)

    def espn_nfl_pbp(self, summary=None, **kwargs):
        return super().espn_nfl_pbp(summary=self._summary, **kwargs)


class _OfflineCFB(CFBPlayProcess):
    """CFBPlayProcess fed from the committed summary; never fetches participants."""

    def __init__(self, gameId=GAMES["cfb"], **kwargs):
        self._summary = _load(f"cfb_summary_{gameId}.json.gz")
        super().__init__(gameId=gameId, **kwargs)

    def espn_cfb_pbp(self, summary=None, **kwargs):
        self.join_participants = (
            False  # the route sets True; offline must not reach ESPN
        )
        return super().espn_cfb_pbp(summary=self._summary, **kwargs)


PROCESSORS = {
    "nfl": (_OfflineNFL, "espn_nfl_pbp"),
    "cfb": (_OfflineCFB, "espn_cfb_pbp"),
}


def _auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


@pytest.fixture(scope="module", params=sorted(GAMES))
def league(request):
    return request.param


@pytest.fixture(scope="module")
def body(league):
    """One processed response per league for the module (a pipeline takes seconds).

    Module-scoped, so no ``monkeypatch``: the overrides are undone by hand."""
    prior_token = os.environ.get("PYTHON_HTTP_TOKEN")
    os.environ["PYTHON_HTTP_TOKEN"] = "secret"
    import app as app_mod

    importlib.reload(app_mod)
    saved = (app_mod._PROCESSORS[league], app_mod.TEL.push, app_mod._emit_dq)
    app_mod._PROCESSORS[league] = PROCESSORS[league]
    app_mod.TEL.push = lambda *a, **k: None
    app_mod._emit_dq = lambda *a, **k: None
    try:
        r = app_mod.app.test_client().get(
            f"/{league}/{GAMES[league]}/process", headers=_auth()
        )
        assert r.status_code == 200, r.get_data(as_text=True)[:300]
        yield r.get_json()
    finally:
        app_mod._PROCESSORS[league], app_mod.TEL.push, app_mod._emit_dq = saved
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


def test_player_usage_and_st_team_have_rows_for_both_teams(body, league):
    box = body["advBoxScore"]
    teams = {
        str(c["team"]["id"]) for c in body["header"]["competitions"][0]["competitors"]
    }
    assert len(teams) == 2

    assert {str(r["pos_team"]) for r in box["player_usage"]} == teams
    assert {str(r["pos_team"]) for r in box["st_team"]} == teams

    # the sections the page tables read all have real rows
    for section in ("team_usage", "drive_scripting", "st_kickers", "st_punters"):
        assert box[section], section
    if league == "nfl":
        for section in PARTICIPANT_SECTIONS:
            assert box[section], section


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

