"""The /nba/<id>/process payload: sdv-py's game-page frames as JSON for the Astro NbaGame adapter."""

from __future__ import annotations

import math
from typing import Any

import polars as pl

PLAY_COLUMNS = [
    "id", "sequence_number", "game_play_number", "period_number", "clock_display_value",
    "start_game_seconds_remaining", "home_score", "away_score", "team_id", "text", "type_text",
    "scoring_play", "score_value", "shooting_play", "athlete_id_1",
    "home_win_prob", "wp_delta", "wp_regime", "x_legacy", "y_legacy",
]


def _rows(df: pl.DataFrame, columns: list[str] | None = None) -> list[dict[str, Any]]:
    cols = [c for c in (columns or df.columns) if c in df.columns]
    out = df.select(cols).to_dicts()
    for row in out:  # polars gives None for null; NaN can survive a float column, and JSON has no NaN
        for k, v in row.items():
            if isinstance(v, float) and math.isnan(v):
                row[k] = None
    return out


def _side(final: dict, home_away: str) -> dict:
    comps = final["header"]["competitions"][0]["competitors"]
    return next(c for c in comps if c.get("homeAway") == home_away)


def build_payload(game_id: int, final: dict, frames: dict) -> dict[str, Any]:
    """Shape sdv-py's frames into the NbaProcessorPayload the Astro adapter reads."""
    comp = final["header"]["competitions"][0]
    status = comp.get("status", {})
    home, away = _side(final, "home"), _side(final, "away")
    team_box: pl.DataFrame = frames["team_box"]
    rates: pl.DataFrame = frames["team_game_rates"]
    player_box: pl.DataFrame = frames["player_box"]
    prates: pl.DataFrame = frames["player_game_rates"]
    if prates.height:
        players = player_box.join(prates.select("athlete_id", "ts_pct", "usg_pct"), on="athlete_id", how="left")
    else:
        players = player_box.with_columns(
            pl.lit(None, dtype=pl.Float64).alias("ts_pct"), pl.lit(None, dtype=pl.Float64).alias("usg_pct")
        )

    def team(side: dict) -> dict[str, Any]:
        tid = int(side["id"])
        box = _rows(team_box.filter(pl.col("team_id") == tid))
        rr = _rows(rates.filter(pl.col("team_id") == tid)) if rates.height else []
        return {
            "team_id": tid,
            "box": box[0] if box else None,
            "rates": rr[0] if rr else None,
            "linescores": [int(float(ls.get("displayValue", 0) or 0)) for ls in side.get("linescores", [])],
        }

    return {
        "gameId": game_id,
        "source": "processor",
        "header": final["header"],
        "teamInfo": {"home": home["team"], "away": away["team"]},
        "status": {
            "name": status.get("type", {}).get("name"),
            "completed": bool(status.get("type", {}).get("completed", False)),
            "period": status.get("period"),
            "display_clock": status.get("displayClock"),
            "detail": status.get("type", {}).get("detail"),
        },
        "prior": frames["prior"],
        "periods": frames["periods"],
        "teams": {"home": team(home), "away": team(away)},
        "players": {
            "home": _rows(players.filter(pl.col("team_id") == int(home["id"]))),
            "away": _rows(players.filter(pl.col("team_id") == int(away["id"]))),
        },
        "plays": _rows(frames["pbp"], PLAY_COLUMNS),
    }
