"""The game page's "How they won it" panel: sportsdataverse-py's game story frames as JSON.

Football reads the processor's enriched play frame (`cfb_game_story` / `nfl_game_story`); basketball reads the
game-page frames (`nba_game_story`). Every function is fail-open: it returns None when the installed
sportsdataverse-py has no game story yet, when the game is not final, or when the frames give no story, so the page
never depends on it. The Astro page renders the payload's `gameStory` only under the 'game-story' preview flag.
"""

from __future__ import annotations

import importlib
import logging
import math
from typing import Any

import polars as pl


def _load(module: str, name: str):
    """One adapter, or None (logged once) when the installed sportsdataverse-py predates it."""
    try:
        return getattr(importlib.import_module(module), name)
    except (ImportError, AttributeError):  # depends on the deployed sdv-py pin
        logging.getLogger("root").warning(f"game story: {module}.{name} not in the installed sportsdataverse-py")
        return None


cfb_game_story = _load("sportsdataverse.cfb.cfb_game_story", "cfb_game_story")
nfl_game_story = _load("sportsdataverse.nfl.nfl_game_story", "nfl_game_story")
nba_game_story = _load("sportsdataverse.nba.nba_game_story", "nba_game_story")

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
