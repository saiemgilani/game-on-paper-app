"""python/game_story.py on real games: the payload the 'game-story' panel reads, and its fail-open paths.

Fixtures (tests/fixtures/game_story/README.md): released play-by-play of real games, copied from
sportsdataverse-py's own game-story fixtures.
"""

from __future__ import annotations

import json
from pathlib import Path

import polars as pl
import pytest

import game_story

FIX = Path(__file__).parent / "fixtures" / "game_story"
def _needs(fn: object) -> pytest.MarkDecorator:
    return pytest.mark.skipif(fn is None, reason="installed sportsdataverse-py has no such game story")


@pytest.mark.parametrize(
    ("league", "name"),
    [
        pytest.param("cfb", "espn_cfb_pbp_games.parquet", marks=_needs(game_story.cfb_game_story)),
        pytest.param("nfl", "espn_nfl_pbp_games.parquet", marks=_needs(game_story.nfl_game_story)),
    ],
)
def test_football_payload_on_real_games(league: str, name: str) -> None:
    frame = pl.read_parquet(FIX / name)
    for gid in frame["game_id"].unique().sort().to_list():
        story = game_story.football(
            frame.filter(pl.col("game_id") == gid), league, completed=True
        )
        assert story is not None
        json.dumps(story, allow_nan=False)  # the page gets plain JSON, never NaN
        s = story["summary"]
        assert s["game_id"] == gid
        ranks = [e["rank"] for e in story["edges"]]
        assert ranks == sorted(ranks) and ranks[0] == 1
        if s["decided"]:
            assert story["edges"][0]["points_worth"] > 0
        assert story["moment"] is not None and story["moment"]["rule"] == "max_abs_wpa"
        assert len(story["performers"]) == 2


@_needs(game_story.nba_game_story)
def test_basketball_payload_on_a_real_game() -> None:
    frames = {
        "pbp": pl.read_parquet(FIX / "nba_401810169_pbp.parquet"),
        "team_box": pl.read_parquet(FIX / "nba_401810169_team_box.parquet"),
        "player_box": pl.read_parquet(FIX / "nba_401810169_player_box.parquet"),
        "league": "nba",
    }
    story = game_story.basketball(frames, completed=True)
    assert story is not None
    s = story["summary"]
    assert (s["home_score"], s["away_score"]) == (125, 120) and s["periods_agree"]
    acct = [e["points_worth"] for e in story["edges"] if e["kind"] == "accounting"]
    assert sum(acct) == pytest.approx(s["margin"])
    assert [p["period_label"] for p in story["periods"]] == ["Q1", "Q2", "Q3", "Q4"]


def test_not_final_or_no_frames_gives_no_story() -> None:
    frame = pl.read_parquet(FIX / "espn_nfl_pbp_games.parquet")
    assert game_story.football(frame, "nfl", completed=False) is None
    assert game_story.football(None, "nfl", completed=True) is None
    assert game_story.football(frame.head(0), "nfl", completed=True) is None
    assert (
        game_story.basketball({"pbp": None, "team_box": None}, completed=True) is None
    )
