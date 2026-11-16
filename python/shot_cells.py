"""The league's as-of shot cells (sdv-db BB-D40 `{lg}.shot_quality_cells`) for the live expected points.

`game_page_frames(..., shot_cells=)` scores every field-goal attempt against these counts and returns
`team_game_expected` (sdv-py BB-D40). The table is rebuilt once a day, ~1.3k rows a league, so one read
per league per worker per day: held in memory for CACHE_SECONDS. A failed read (no key, an outage, a
429) gives None, so the page draws without the expected columns, and is not retried for
RETRY_SECONDS: a down or rate-limited Data API never gets one read per game request.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.request

import polars as pl
from sportsdataverse.nba.nba_game_expected import CELLS_SCHEMA

API_BASE = os.environ.get("SDV_API_BASE", "https://data.sportsdataverse.org/v1")
CACHE_SECONDS = 24 * 60 * 60
RETRY_SECONDS = 10 * 60
TIMEOUT_SECONDS = 5
# ~1.3k rows a league today; a read at the cap is truncated, and a partial table would misprice every shot
LIMIT = 5000

_cache: dict[str, tuple[float, pl.DataFrame | None]] = {}
log = logging.getLogger("root")


def _get(url: str, token: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as r:  # noqa: S310 - fixed https base
        return json.loads(r.read())


def cells_frame(rows: list[dict]) -> pl.DataFrame:
    """The API rows as sdv-py's CELLS_SCHEMA (the API's `as_of` dropped)."""
    return pl.DataFrame(
        [{c: r.get(c) for c in CELLS_SCHEMA} for r in rows],
        schema=CELLS_SCHEMA,
        orient="row",
    )


def league_shot_cells(league: str, now: float | None = None) -> pl.DataFrame | None:
    """The league's cells, or None when they can't be read (the expected columns are then null)."""
    now = time.time() if now is None else now
    held = _cache.get(league)
    if held and now - held[0] < (
        CACHE_SECONDS if held[1] is not None else RETRY_SECONDS
    ):
        return held[1]
    # never send an empty key: a bad token trips the Data API's IP-wide rate limit
    token = (os.environ.get("SDV_AUTH_TOKEN") or "").strip()
    cells = None
    if token:
        try:
            body = _get(f"{API_BASE}/{league}/shot_quality_cells?limit={LIMIT}", token)
            rows = body.get("data") or []
            if not rows or len(rows) >= LIMIT:
                raise ValueError(f"{len(rows)} rows (empty, or at the {LIMIT} cap)")
            cells = cells_frame(rows)
        except Exception as e:  # noqa: BLE001 - decorative: any failure draws the page without expected points
            log.warning("%s shot_quality_cells unavailable: %r", league, e)
    _cache[league] = (now, cells)
    return cells
