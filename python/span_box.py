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


def _plays_frame(game):
    """The enriched polars frame, or None.

    sdv-py's run_processing ends with ``self.plays_json = plays_json.to_dicts()``
    and app.py then MUTATES those records (nesting start/end, deleting the flat
    dotted columns create_box_score needs) -- so ``.filter`` threw on every
    ?span= request and the fail-open except silently kept the full box
    (advBoxScoreSpan was never set) from #206 until 2026-09-07. sdv-py now
    retains the pre-conversion frame as ``plays_frame`` (sdv-py #464); reading
    anything else here is wrong by construction.
    """
    frame = getattr(game, "plays_frame", None)
    if isinstance(frame, pl.DataFrame):
        return frame
    plays = getattr(game, "plays_json", None)
    return plays if isinstance(plays, pl.DataFrame) else None


def spanned_box(game, raw_span):
    """Recompute advBoxScore over the window. Returns (box_dict, key) or (None, None)
    when the span is invalid or selects no plays (caller keeps the full box)."""
    parsed = parse_span(raw_span)
    if parsed is None:
        return None, None
    frame = _plays_frame(game)
    if frame is None:
        return None, None
    key, expr = parsed
    box = _box_for(game, frame, expr)
    return (box, key) if box is not None else (None, None)


def _box_for(game, frame, expr):
    sliced = frame.filter(expr)
    if sliced.height == 0:
        return None
    return game.create_box_score(sliced)


# render order for the standard windows; a window absent from the game
# (no OT, or a live game still in Q1) is simply omitted
_ALL_KEYS = ("q1", "q2", "h1", "q3", "q4", "h2", "ot")


def all_span_boxes(game):
    """Every standard window's box in ONE response, for in-place span
    switching on the game page (no per-span navigation, no per-span API
    round trips). The EP/WP pipeline already ran full-game; each window is
    only a filter + re-aggregation. Windows with no plays are omitted.
    Returns {} when plays are unavailable."""
    frame = _plays_frame(game)
    if frame is None:
        return {}
    out = {}
    for key in _ALL_KEYS:
        _, expr = parse_span(key)
        box = _box_for(game, frame, expr)
        if box is not None:
            out[key] = box
    return out
