"""Data-quality rows for the admin dashboard.

Two products, both written through TEL after a completed game is processed:

- ``game_meta``: one upserted row per game (matchup, score, status) so admin
  views can show "UNC @ TCU" instead of a bare game id.
- ``dq_boxscore``: per-team deltas between the box score we aggregate from
  play-text flags (``advBoxScore.team``) and ESPN's official team box
  (``advBoxScore.espn_team``), plus reference-free lints over the plays.

Our side is derived from plays under ESPN/NCAA OFFICIAL conventions rather
than read off ``advBoxScore.team`` -- those columns are modeling aggregates
(adjusted rush yardage, sacks kept with pass plays, penalty first downs split
out), and diffing them against the official box drowned real signal in
convention offsets (rush_yards had |delta|>2 in 86%% of games). Conventions,
measured against 16 team-games on 2026-09-07:

- sacks are RUSHING attempts and their (negative) yardage is rushing yardage;
- pass yards count completions only (``netPassingYards`` is gross in CFB);
- attempts/completions come from the official ``completionAttempts`` "C/A"
  string (there is no ``pass_attempts`` key -- the old pair diffed against
  None forever);
- a touchdown counts as a first down;
- penalties count ACCEPTED flags only, attributed via ``penalty_team_id``.

Residual deltas are a few yards/units per game (spotters vs play-text); the
dashboard's signal is the STABILITY of each delta's distribution across games
and sdv-py versions -- a parser regression shows up as a version-aligned
shift, the way the 2025 late-insert and penalty-EPA bugs would have.
Rows written before 2026-09-07 predate this reconciliation (and use the stat
name ``first_downs_created`` instead of ``first_downs``); window queries
accordingly.
"""

from datetime import datetime, timezone


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


def _parse_ca(v):
    """ESPN's ``completionAttempts`` "15/21" -> (15.0, 21.0)."""
    parts = str(v or "").split("/")
    if len(parts) != 2:
        return None, None
    return _num(parts[0]), _num(parts[1])


def _official_box(plays, team_box):
    """Per-team stats under official conventions, derived from plays.

    See the module docstring for the convention list and its measurement.
    """
    agg = {}

    def team(tid):
        return agg.setdefault(
            int(tid),
            {
                "rush_attempts": 0.0,
                "rush_yards": 0.0,
                "pass_attempts": 0.0,
                "completions": 0.0,
                "pass_yards": 0.0,
                "first_downs": 0.0,
                "penalties": 0.0,
                "penalty_yards": 0.0,
            },
        )

    for p in plays:
        tid = p.get("pos_team")
        if tid is not None:
            a = team(tid)
            yards = _num(p.get("statYardage")) or 0.0
            if p.get("sack") == True:  # noqa: E712
                a["rush_attempts"] += 1
                a["rush_yards"] += _num(p.get("yds_sacked")) or 0.0
            elif p.get("rush") == True:  # noqa: E712
                a["rush_attempts"] += 1
                a["rush_yards"] += yards
            elif p.get("pass") == True:  # noqa: E712
                a["pass_attempts"] += 1
                if p.get("completion") == True:  # noqa: E712
                    a["completions"] += 1
                    a["pass_yards"] += yards
            # A TD counts as a first down officially; scrimmage TDs don't
            # carry first_down_created, so add them on top of the box counts.
            if (
                p.get("scrimmage_play") == True  # noqa: E712
                and p.get("touchdown") == True  # noqa: E712
                and p.get("first_down_created") != True  # noqa: E712
            ):
                a["first_downs"] += 1
        ptid = p.get("penalty_team_id")
        if (
            ptid is not None
            and p.get("penalty_flag") == True  # noqa: E712
            and p.get("penalty_declined") != True  # noqa: E712
        ):
            pa = team(ptid)
            pa["penalties"] += 1
            pa["penalty_yards"] += abs(_num(p.get("yds_penalty")) or 0.0)
    # First downs by pass/rush/penalty come from the box counts (which match
    # the official tally); only the TD top-up above is play-derived.
    for t in team_box or []:
        tid = t.get("pos_team")
        if tid is None:
            continue
        a = team(tid)
        for k in (
            "passing_first_downs_created",
            "rushing_first_downs_created",
            "penalty_first_downs_created",
        ):
            a["first_downs"] += _num(t.get(k)) or 0.0
    return agg


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
    plays = processed_game.get("plays") or []
    ours_by_team = _official_box(plays, box.get("team"))
    for espn in box.get("espn_team") or []:
        tid = espn.get("team_id")
        if tid is None or int(tid) not in ours_by_team:
            continue
        ours_box = ours_by_team[int(tid)]
        comp, att = _parse_ca(espn.get("completionAttempts"))
        espn_vals = {
            "rush_attempts": _num(espn.get("rushingAttempts")),
            "rush_yards": _num(espn.get("rushingYards")),
            "pass_attempts": att,
            "completions": comp,
            "pass_yards": _num(espn.get("netPassingYards")),
            "first_downs": _num(espn.get("firstDowns")),
            "penalties": _num(espn.get("penalties")),
            "penalty_yards": _num(espn.get("penalty_yards")),
        }
        for stat, theirs in espn_vals.items():
            ours = ours_box[stat]
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
