"""How exciting a game was, with no direction: who led, by how much and who won stay out.

The spoiler-free share card prints these three numbers in place of the score.

- ``gei``: the Game Excitement Index the WP chart shows, the same formula and scale
  as ``calculateGEI`` in ``astro/src/resources/python.ts``. The last play of a final
  swings to the result: the home side's WP is 1 if it won, 0 if it lost, 0.5 for a
  tie, whoever had the ball. While the game is live it sums the swings so far.
- ``lead_changes``: how often the scoring leader flipped, over scoring plays. A tie is
  not a lead, so A ahead, tied, then B ahead counts once.
- ``max_swing_pts``: the largest single-play win-probability change, in percentage
  points, with no team named.
"""

# the WP chart's normalisation (astro/src/resources/python.ts calculateGEI)
GEI_SCALE = 179.01777401608126


def _home_wp(play, home_id):
    before = (play.get("winProbability") or {}).get("before")
    if before is None:
        return None
    return before if str(play.get("pos_team")) == home_id else 1.0 - before


def _gei(plays, home_id, completed):
    diffs = []
    for i, play in enumerate(plays):
        wp = _home_wp(play, home_id)
        if i + 1 < len(plays):
            nxt = _home_wp(plays[i + 1], home_id)
        elif completed:
            # the result, whoever had the ball on the last play
            margin = play.get("homeScore", 0) - play.get("awayScore", 0)
            nxt = 1.0 if margin > 0 else 0.0 if margin < 0 else 0.5
        else:
            break  # live: no final value to swing to yet
        if wp is not None and nxt is not None:
            diffs.append(abs(nxt - wp))
    return GEI_SCALE / len(plays) * sum(diffs) if plays else None


def _lead_changes(plays):
    leader, changes = 0, 0
    for play in plays:
        if not play.get("scoringPlay"):
            continue
        margin = play.get("homeScore", 0) - play.get("awayScore", 0)
        now = (margin > 0) - (margin < 0)
        if now:
            changes += leader not in (0, now)
            leader = now
    return changes


def summary(processed_game: dict) -> dict:
    """`{gei, lead_changes, max_swing_pts}` for one `/process` payload."""
    plays = processed_game.get("plays") or []
    comp = processed_game["header"]["competitions"][0]
    home_id = next(
        str(c["team"]["id"]) for c in comp["competitors"] if c.get("homeAway") == "home"
    )
    completed = ((comp.get("status") or {}).get("type") or {}).get("completed") is True
    swings = [
        abs(a)
        for p in plays
        if (a := (p.get("winProbability") or {}).get("added")) is not None
    ]
    return {
        "gei": _gei(plays, home_id, completed),
        "lead_changes": _lead_changes(plays),
        "max_swing_pts": 100 * max(swings) if swings else None,
    }
