"""Data-quality rows for the admin dashboard.

Two products, both written through TEL after a completed game is processed:

- ``game_meta``: one upserted row per game (matchup, score, status) so admin
  views can show "UNC @ TCU" instead of a bare game id.
- ``dq_boxscore``: per-team deltas between the box score we aggregate from
  play-text flags (``advBoxScore.team``) and ESPN's official team box
  (``advBoxScore.espn_team``), plus reference-free lints over the plays.

Zero is NOT the target for every stat -- our ``pass`` flag counts sacks and
ESPN's net passing subtracts sack yardage, so some pairs carry a structural
offset. The dashboard's signal is the STABILITY of each delta's distribution
across games and sdv-py versions: a parser regression shows up as a
version-aligned shift, the way the 2025 late-insert and penalty-EPA bugs
would have.
"""

from datetime import datetime, timezone

# (stat name, our team-box column, ESPN official-box key)
BOX_PAIRS = [
    ("rush_attempts", "rushes", "rushingAttempts"),
    ("rush_yards", "rush_yards", "rushingYards"),
    ("pass_attempts", "passes", "pass_attempts"),
    ("pass_yards", "pass_yards", "netPassingYards"),
    ("penalties", "penalties", "penalties"),
    ("penalty_yards", "penalty_yards", "penalty_yards"),
    ("first_downs_created", None, "firstDowns"),  # ours = passing + rushing created
]


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def build_game_meta_row(header, game_id):
    """One upsertable row from an ESPN game header (``pbp['header']`` shape)."""
    comp = (header or {}).get("competitions", [{}])[0]
    status = (comp.get("status") or {}).get("type") or {}
    sides = {c.get("homeAway"): c for c in comp.get("competitors", []) or []}
    home, away = sides.get("home", {}), sides.get("away", {})
    season = (header or {}).get("season") or {}
    week = (header or {}).get("week")
    return {
        "game_id": int(game_id),
        "season": season.get("year"),
        "week": week
        if isinstance(week, int)
        else (week or {}).get("number")
        if isinstance(week, dict)
        else None,
        "away_abbr": (away.get("team") or {}).get("abbreviation"),
        "home_abbr": (home.get("team") or {}).get("abbreviation"),
        "away_score": _num(away.get("score")),
        "home_score": _num(home.get("score")),
        "status": status.get("name"),
        "kickoff_ts": comp.get("date"),
        "last_seen": datetime.now(timezone.utc),
    }


def build_dq_rows(processed_game, game_id, sdv_version=None, sdv_sha=None):
    """Per-team box deltas + game-level lints for one completed game."""
    ts = datetime.now(timezone.utc)
    base = {
        "ts": ts,
        "game_id": int(game_id),
        "sdv_py_version": sdv_version,
        "sdv_py_sha": sdv_sha,
    }
    rows = []
    box = processed_game.get("advBoxScore") or {}
    espn_by_team = {
        int(t["team_id"]): t
        for t in box.get("espn_team") or []
        if t.get("team_id") is not None
    }
    for team in box.get("team") or []:
        tid = team.get("pos_team")
        if tid is None or int(tid) not in espn_by_team:
            continue
        espn = espn_by_team[int(tid)]
        for stat, ours_key, espn_key in BOX_PAIRS:
            if ours_key is None:
                ours = _num(team.get("passing_first_downs_created"))
                extra = _num(team.get("rushing_first_downs_created"))
                ours = (
                    None
                    if ours is None and extra is None
                    else (ours or 0) + (extra or 0)
                )
            else:
                ours = _num(team.get(ours_key))
            theirs = _num(espn.get(espn_key))
            if ours is None and theirs is None:
                continue
            rows.append(
                {
                    **base,
                    "team_id": int(tid),
                    "stat": stat,
                    "ours": ours,
                    "espn": theirs,
                    "delta": None if ours is None or theirs is None else ours - theirs,
                }
            )
    # Reference-free lints: espn is NULL and the expectation is delta == 0.
    plays = processed_game.get("plays") or []
    scrimmage = [p for p in plays if p.get("scrimmage_play") == True]  # noqa: E712
    lints = {
        "lint:epa_null": sum(1 for p in scrimmage if p.get("EPA") is None),
        "lint:wp_oob": sum(
            1
            for p in plays
            for v in (p.get("wp_before"), p.get("wp_after"))
            if v is not None and not (0.0 <= v <= 1.0)
        ),
        "lint:ep_between_big": sum(
            1
            for p in plays
            if p.get("EP_between") is not None and abs(p["EP_between"]) > 3.0
        ),
    }
    for stat, n in lints.items():
        rows.append(
            {
                **base,
                "team_id": None,
                "stat": stat,
                "ours": float(n),
                "espn": None,
                "delta": float(n),
            }
        )
    rows.append(
        {
            **base,
            "team_id": None,
            "stat": "plays",
            "ours": float(len(plays)),
            "espn": None,
            "delta": None,
        }
    )
    return rows
