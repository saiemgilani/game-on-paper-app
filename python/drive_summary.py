"""Drive summary + drive chart, StatBroadcast-style, for the game page.

Computed from two sources, deliberately split:
- the ESPN drives grouping (ordered, with ``team.id``) for anything drive-level
  -- drive ids on PLAYS span both teams, so per-drive attribution must come
  from ``drive.team``, never from plays grouped by drive id;
- the enriched polars frame sdv-py retains as ``plays_frame`` (sdv-py #464)
  for play-flag aggregates (third downs, first-down sources, long plays,
  score-state clock).

Definitions follow the StatBroadcast game book where one exists:
- three-and-out: <= 3 offensive plays, lost by punt;
- a 3rd/4th-down TD counts as a conversion;
- points off turnovers: points the defense scores during the turnover drive
  (pick-six et al) plus points on the ensuing possession;
- drive success ships under TWO named metrics (maintainer decision):
  ``drive_success_rate_fd`` (>= 1 first down or score) and
  ``drive_success_rate_ay`` (>= 50% of available yards, TDs are 100%).
Known approximation: a drive's time of possession is assigned to the quarter
it STARTED in (a drive spanning the break books whole to the earlier quarter).
"""

import re

import polars as pl

_TURNOVER_RESULTS = {"INT", "FUMBLE", "INT TD", "FUMBLE TD"}
_SCORING_KICKOFF_NEXT = {"TD", "FG", "INT TD", "FUMBLE TD", "MADE FG"}


def _top_seconds(drive):
    raw = ((drive.get("timeElapsed") or {}).get("displayValue") or "").strip()
    parts = raw.split(":")
    if len(parts) == 2 and all(p.isdigit() for p in parts):
        return int(parts[0]) * 60 + int(parts[1])
    return None


def _spot(drive, which):
    node = drive.get(which) or {}
    return (node.get("text") or "").strip() or None


def _clock(drive, which):
    node = drive.get(which) or {}
    return ((node.get("clock") or {}).get("displayValue") or "").strip() or None


def _period(drive):
    return ((drive.get("start") or {}).get("period") or {}).get("number")


def _team_id(drive):
    tid = (drive.get("team") or {}).get("id")
    return str(tid) if tid is not None else None


def _yards_to_endzone(drive, is_home):
    """Distance to the end zone at the drive start, for the DRIVING team.

    ESPN's drive ``start.yardLine`` runs on a HOME-oriented 0-100 axis, so
    the away team's distance is ``yardLine`` and the home team's is
    ``100 - yardLine``. The ``start.text`` ("TCU 25") is authoritative when
    it parses: the named side says whose half the ball is on.
    """
    start = drive.get("start") or {}
    text = (start.get("text") or "").strip()
    abbr = ((drive.get("team") or {}).get("abbreviation") or "").upper()
    m = re.match(r"([A-Z&'-]+)\s+(\d{1,2})$", text.upper()) if text else None
    if m and abbr:
        side, num = m.group(1), int(m.group(2))
        return (100 - num) if side == abbr else num
    yl = start.get("yardLine")
    if not isinstance(yl, (int, float)):
        return None
    return (100 - yl) if is_home else yl


def _score_after(drive, prev_home, prev_away):
    """(home, away) after the drive's last play; carried forward when absent."""
    plays = drive.get("plays") or []
    for p in reversed(plays):
        h, a = p.get("homeScore"), p.get("awayScore")
        if h is not None and a is not None:
            return int(h), int(a)
    return prev_home, prev_away


def _obtained(prev_result, is_first_of_half):
    if is_first_of_half or prev_result is None:
        return "KO"
    r = prev_result.upper()
    if r in _SCORING_KICKOFF_NEXT:
        return "KO"
    if r == "PUNT":
        return "PUNT"
    if "INT" in r:
        return "INT"
    if "FUMBLE" in r:
        return "FUM"
    if r == "DOWNS":
        return "DOWNS"
    if "FG" in r:  # missed FG variants
        return "FG MISS"
    return r


def build(drives, frame, home_id, away_id):
    """-> the driveSummary dict, or None when inputs are unusable."""
    if not drives or not isinstance(frame, pl.DataFrame) or frame.height == 0:
        return None
    home_id, away_id = str(home_id), str(away_id)
    team_ids = {home_id, away_id}

    def blank():
        return {
            "total_drives": 0,
            "scoring_drives": 0,
            "td_drives": 0,
            "yards": 0,
            "plays": 0,
            "top_seconds": 0,
            "long_drives_70yds": 0,
            "long_drives_10plays": 0,
            "drives_over_5min": 0,
            "drives_under_1min": 0,
            "three_and_outs": 0,
            "forced_three_and_outs": 0,
            "points_off_turnovers": 0,
            "success_fd": 0,
            "success_ay": 0,
            "start_yte_sum": 0,
            "start_yte_n": 0,
            "top_by_quarter": {},
        }

    teams = {home_id: blank(), away_id: blank()}
    chart = []
    scores = []

    h, a = 0, 0
    ordered = [d for d in drives if _team_id(d) in team_ids]
    for i, d in enumerate(ordered):
        tid = _team_id(d)
        opp = away_id if tid == home_id else home_id
        t = teams[tid]
        result = (d.get("result") or "").upper()
        top = _top_seconds(d)
        yards = d.get("yards") or 0
        plays = d.get("offensivePlays") or 0
        yte = _yards_to_endzone(d, tid == home_id)
        period = _period(d)

        prev = ordered[i - 1] if i > 0 else None
        first_of_half = prev is None or (
            _period(prev) is not None
            and period is not None
            and (_period(prev) <= 2 < period)
        )

        t["total_drives"] += 1
        t["yards"] += yards
        t["plays"] += plays
        if top is not None:
            t["top_seconds"] += top
            if period is not None:
                q = t["top_by_quarter"].setdefault(int(period), 0)
                t["top_by_quarter"][int(period)] = q + top
            if top >= 300:
                t["drives_over_5min"] += 1
            if top < 60:
                t["drives_under_1min"] += 1
        if yards >= 70:
            t["long_drives_70yds"] += 1
        if plays >= 10:
            t["long_drives_10plays"] += 1
        if yte is not None:
            t["start_yte_sum"] += yte
            t["start_yte_n"] += 1
        if d.get("isScore"):
            t["scoring_drives"] += 1
        if result in ("TD",):
            t["td_drives"] += 1
        if plays <= 3 and result == "PUNT":
            t["three_and_outs"] += 1
            teams[opp]["forced_three_and_outs"] += 1

        # score deltas across this drive, for points-off-turnovers + scores list
        h2, a2 = _score_after(d, h, a)
        own_delta = (h2 - h) if tid == home_id else (a2 - a)
        opp_delta = (a2 - a) if tid == home_id else (h2 - h)
        # a defensive score during the turnover drive itself (pick-six)
        if result in _TURNOVER_RESULTS and opp_delta > 0:
            teams[opp]["points_off_turnovers"] += opp_delta
        # the ensuing possession after a turnover
        if (
            prev is not None
            and (prev.get("result") or "").upper() in _TURNOVER_RESULTS
            and _team_id(prev) == opp
            and own_delta > 0
        ):
            t["points_off_turnovers"] += own_delta

        if d.get("isScore"):
            finishing = None
            for p in reversed(d.get("plays") or []):
                if p.get("text"):
                    finishing = p["text"]
                    break
            scores.append(
                {
                    "team_id": tid,
                    "period": period,
                    "result": result,
                    "description": d.get("description"),
                    "finishing_play": finishing,
                }
            )

        chart.append(
            {
                "team_id": tid,
                "period": period,
                "start_spot": _spot(d, "start"),
                "start_clock": _clock(d, "start"),
                "obtained": _obtained(
                    (prev.get("result") if prev else None), first_of_half
                ),
                "end_spot": _spot(d, "end"),
                "end_clock": _clock(d, "end"),
                "result": result or None,
                "plays": plays,
                "yards": yards,
                "top_seconds": top,
            }
        )

        # drive success, both named metrics
        succeeded_fd = bool(d.get("isScore"))
        if not succeeded_fd:
            sub = frame.filter(
                (pl.col("drive.id") == d.get("id"))
                & (pl.col("pos_team").cast(pl.Utf8) == tid)
            )
            succeeded_fd = bool(
                sub.select(
                    (pl.col("first_down_created") == True).any()  # noqa: E712
                    | (pl.col("firstD_by_penalty") == True).any()  # noqa: E712
                ).item()
            )
        if succeeded_fd:
            t["success_fd"] += 1
        if yte and (yards / yte) >= 0.5:
            t["success_ay"] += 1
        elif result == "TD":
            t["success_ay"] += 1

        h, a = h2, a2

    # frame-side aggregates per team
    scrim = frame.filter(pl.col("scrimmage_play") == True)  # noqa: E712
    for tid, t in teams.items():
        mine = scrim.filter(pl.col("pos_team").cast(pl.Utf8) == tid)
        third = mine.filter(pl.col("down") == 3)
        fourth = mine.filter(pl.col("down") == 4)
        conv = lambda df: int(  # noqa: E731
            df.select(
                (
                    (pl.col("first_down_created") == True)
                    | (pl.col("touchdown") == True)
                ).sum()
            ).item()  # noqa: E712
        )
        t["avg_third_down_distance"] = (
            round(third["distance"].mean(), 1) if third.height else None
        )
        t["third_downs"] = {"made": conv(third), "att": third.height}
        t["fourth_downs"] = {"made": conv(fourth), "att": fourth.height}
        t["first_downs"] = {
            "rush": int(
                mine.select(
                    (
                        (pl.col("first_down_created") == True)
                        & (pl.col("rush") == True)
                    ).sum()
                ).item()
            ),  # noqa: E712
            "pass": int(
                mine.select(
                    (
                        (pl.col("first_down_created") == True)
                        & (pl.col("pass") == True)
                    ).sum()
                ).item()
            ),  # noqa: E712
            "penalty": int(
                frame.select(
                    (
                        (pl.col("firstD_by_penalty") == True)
                        & (pl.col("pos_team").cast(pl.Utf8) == tid)
                    ).sum()
                ).item()
            ),  # noqa: E712
        }

        n = t["total_drives"] or 1
        t["scoring_pct"] = round(t["scoring_drives"] / n, 3)
        t["td_rate"] = round(t["td_drives"] / n, 3)
        t["drive_success_rate_fd"] = round(t["success_fd"] / n, 3)
        t["drive_success_rate_ay"] = round(t["success_ay"] / n, 3)
        t["avg_yards"] = round(t["yards"] / n, 1)
        t["avg_plays"] = round(t["plays"] / n, 1)
        t["avg_top_seconds"] = round(t["top_seconds"] / n)
        if t["start_yte_n"]:
            yte = t["start_yte_sum"] / t["start_yte_n"]
            own = round(100 - yte)
            t["avg_start_yards_to_endzone"] = round(yte, 1)
            t["avg_start_text"] = f"OWN {own}" if own <= 50 else f"OPP {100 - own}"
        else:
            t["avg_start_yards_to_endzone"] = None
            t["avg_start_text"] = None
        del t["success_fd"], t["success_ay"], t["start_yte_sum"], t["start_yte_n"]

    # largest lead + minutes leading/trailing/tied from the score-state clock
    # (regulation only -- OT clocks don't tick the same axis)
    reg = scrim.filter(pl.col("period") <= 4).sort("game_play_number")
    lead = {home_id: 0, away_id: 0}
    clockstate = {home_id: 0, away_id: 0, "tied": 0}
    rows = reg.select(
        ["start.adj_TimeSecsRem", "start.homeScore", "start.awayScore"]
    ).to_dicts()
    for j, r in enumerate(rows):
        hh, aa = r.get("start.homeScore") or 0, r.get("start.awayScore") or 0
        lead[home_id] = max(lead[home_id], hh - aa)
        lead[away_id] = max(lead[away_id], aa - hh)
        if j + 1 < len(rows):
            dt = (r.get("start.adj_TimeSecsRem") or 0) - (
                rows[j + 1].get("start.adj_TimeSecsRem") or 0
            )
            dt = max(0, dt)
        else:
            dt = max(0, r.get("start.adj_TimeSecsRem") or 0)
        key = home_id if hh > aa else away_id if aa > hh else "tied"
        clockstate[key] += dt
    for tid, t in teams.items():
        t["largest_lead"] = lead[tid]
        t["time_leading_seconds"] = round(clockstate[tid])
    tied_s = round(clockstate["tied"])
    for t in teams.values():
        t["time_tied_seconds"] = tied_s

    # long plays: top 5 scrimmage gains per team
    long_plays = {}
    for tid in team_ids:
        top5 = (
            scrim.filter(pl.col("pos_team").cast(pl.Utf8) == tid)
            .sort("statYardage", descending=True)
            .head(5)
            .select(["statYardage", "period", "text"])
            .to_dicts()
        )
        long_plays[tid] = [
            {"yards": p["statYardage"], "period": p["period"], "text": p["text"]}
            for p in top5
            if (p["statYardage"] or 0) > 0
        ]

    return {"teams": teams, "chart": chart, "scores": scores, "longPlays": long_plays}
