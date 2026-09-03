"""Windowed advanced box scores for ?span= on the game page.

The EP/WP pipeline must always run on the FULL game (lags, cumulative state,
model context), so per-play metrics are computed whole-game and only the
AGGREGATION is windowed: filter the enriched polars frame, re-run
create_box_score on the slice. Mirrors astro's utils/span.ts specs:
q1..q4, h1, h2, ot, or "<from>-<to>" in game-clock seconds remaining
(30s buckets, regulation only).

What cannot be windowed, ever:
- espn_team / espn_players: ESPN publishes the official box full-game only;
  create_box_score re-parses them from the summary, so they come out
  identical on a slice -- inherently full-game, the UI labels them.
- season percentiles / GEI / spread: game- or season-scalar reference
  classes; a Q3 box against full-game distributions is a category error.
"""

import polars as pl

_PERIODS = {
    "q1": [1],
    "q2": [2],
    "q3": [3],
    "q4": [4],
    "h1": [1, 2],
    "h2": [3, 4],
}


def parse_span(raw):
    """-> (key, polars filter expr) or None."""
    if not raw:
        return None
    key = str(raw).strip().lower()
    if key in _PERIODS:
        return key, pl.col("period").is_in(_PERIODS[key])
    if key == "ot":
        return "ot", pl.col("period") > 4
    parts = key.split("-")
    if len(parts) == 2 and all(p.isdigit() for p in parts):
        # half-up like JS Math.round -- Python's round() is half-even, and a direct
        # API caller sending 45 must land in the same bucket the worker computes
        bucket = lambda n: int(n / 30 + 0.5) * 30  # noqa: E731
        frm, to = bucket(min(int(parts[0]), 3600)), bucket(max(int(parts[1]), 0))
        if frm > to:
            return f"{frm}-{to}", (
                (pl.col("start.adj_TimeSecsRem") <= frm)
                & (pl.col("start.adj_TimeSecsRem") >= to)
                & (pl.col("period") <= 4)
            )
    return None


def spanned_box(game, raw_span):
    """Recompute advBoxScore over the window. Returns (box_dict, key) or (None, None)
    when the span is invalid or selects no plays (caller keeps the full box)."""
    parsed = parse_span(raw_span)
    if parsed is None or getattr(game, "plays_json", None) is None:
        return None, None
    key, expr = parsed
    sliced = game.plays_json.filter(expr)
    if sliced.height == 0:
        return None, None
    return game.create_box_score(sliced), key
