"""The game page's "How they won it" panel: sportsdataverse-py's game story frames as JSON.

Football reads the processor's enriched play frame (`cfb_game_story` / `nfl_game_story`); basketball reads the
game-page frames (`nba_game_story`). Every function is fail-open: it returns None when the installed
sportsdataverse-py has no game story yet, when the game is not final, or when the frames give no story, so the page
never depends on it. The Astro page renders the payload's `gameStory` only under the 'game-story' preview flag.
"""

from __future__ import annotations

import math
from typing import Any

import polars as pl

try:  # sportsdataverse-py ships the game story from its game-story release on
    from sportsdataverse.cfb.cfb_game_story import cfb_game_story
    from sportsdataverse.nba.nba_game_story import nba_game_story
    from sportsdataverse.nfl.nfl_game_story import nfl_game_story
except ImportError:  # pragma: no cover - depends on the deployed sdv-py pin
    cfb_game_story = nfl_game_story = nba_game_story = None

#: edges shown on the page: the largest few by points worth
TOP_EDGES = 3


def _rows(df: pl.DataFrame) -> list[dict[str, Any]]:
    out = df.to_dicts()
    for row in out:  # JSON has no NaN
        for k, v in row.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                row[k] = None
    return out


def _payload(story: dict[str, pl.DataFrame]) -> dict[str, Any] | None:
    """One game's frames as JSON: the summary and moment as objects, the rest as rows. None without a winner row."""
    summary = _rows(story["summary"])
    if not summary:
        return None
    moment = _rows(story["moment"])
    return {
        "summary": summary[0],
        "edges": _rows(story["edges"].sort("rank")),
        "moment": moment[0] if moment else None,
        "periods": _rows(story["periods"]),
        "runs": _rows(story["runs"]),
        "performers": _rows(story["performers"]),
    }


def football(
    frame: pl.DataFrame | None, league: str, completed: bool
) -> dict[str, Any] | None:
    """The story of a final football game from the processor's play frame; None otherwise."""
    fn = {"cfb": cfb_game_story, "nfl": nfl_game_story}.get(league)
    if fn is None or frame is None or not completed or frame.height == 0:
        return None
    return _payload(fn(frame))


def basketball(frames: dict[str, Any], completed: bool) -> dict[str, Any] | None:
    """The story of a final basketball game from the game-page frames; None otherwise."""
    if nba_game_story is None or not completed:
        return None
    pbp, team_box = frames.get("pbp"), frames.get("team_box")
    if pbp is None or team_box is None or pbp.height == 0 or team_box.height != 2:
        return None
    return _payload(
        nba_game_story(pbp, team_box, frames["player_box"], league=frames["league"])
    )
