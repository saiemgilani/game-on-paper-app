import app


def _record(**over):
    base = {
        "clock.displayValue": "12:34",
        "clock.minutes": 12,
        "clock.seconds": 34,
        "type.id": "5",
        "type.text": "Rush",
        "type.abbreviation": "RUSH",
        "start.down": 1,
        "start.distance": 10,
        "start.yardsToEndzone": 75,
        "start.TimeSecsRem": 1800,
        "start.adj_TimeSecsRem": 3600,
        "pos_score_diff_start": 0,
        "start.posTeamTimeouts": 3,
        "start.defPosTeamTimeouts": 3,
        "start.ExpScoreDiff": 0.1,
        "start.ExpScoreDiff_Time_Ratio": 0.0,
        "start.spread_time": -2.0,
        "start.pos_team_receives_2H_kickoff": 1,
        "start.is_home": 1,
        "period": 1,
        "end.down": 2,
        "end.distance": 7,
        "end.yardsToEndzone": 72,
        "end.TimeSecsRem": 1770,
        "end.adj_TimeSecsRem": 3570,
        "end.posTeamTimeouts": 3,
        "end.defPosTeamTimeouts": 3,
        "end.ExpScoreDiff": 0.2,
        "end.ExpScoreDiff_Time_Ratio": 0.0,
        "end.spread_time": -2.0,
        "end.pos_team_receives_2H_kickoff": 1,
        "pos_score_diff_end": 0,
        "EP_start": 1.0,
        "EP_end": 1.3,
        "EPA": 0.3,
        "wp_before": 0.5,
        "wp_after": 0.51,
        "wpa": 0.01,
        "start.team.id": "1",
        "start.pos_team.id": "1",
        "start.pos_team.name": "A",
        "start.def_pos_team.id": "2",
        "start.def_pos_team.name": "B",
        "start.pos_team_score": 0,
        "start.def_pos_team_score": 0,
        "start.homeScore": 0,
        "start.awayScore": 0,
        "start.yardLine": 25,
        "start.pos_team_spread": -2.0,
        "end.team.id": "1",
        "end.pos_team.id": "1",
        "end.pos_team.name": "A",
        "end.def_pos_team.id": "2",
        "end.def_pos_team.name": "B",
        "end.pos_team_score": 0,
        "end.def_pos_team_score": 0,
        "end.homeScore": 0,
        "end.awayScore": 0,
        "end.yardLine": 28,
        "end.is_home": 1,
        "start.shortDownDistanceText": "1st & 10",
        "start.possessionText": "A 25",
        "start.downDistanceText": "1st & 10 at A 25",
        "end.shortDownDistanceText": "2nd & 7",
        "end.possessionText": "A 28",
        "end.downDistanceText": "2nd & 7 at A 28",
        "expectedPoints.before": 1.0,
        "winProbability.before": 0.5,
        "scoringType.name": None,
        "text": "rush for 3 yards",
        "some_nan": float("nan"),
    }
    base.update(over)
    return base


def test_reshape_nests_and_strips():
    recs = [_record()]
    app._reshape_records(recs)
    r = recs[0]
    assert r["clock"] == {"displayValue": "12:34", "minutes": 12, "seconds": 34}
    assert r["type"]["abbreviation"] == "RUSH"
    assert (
        r["modelInputs"]["start"]["down"] == 1
        and r["modelInputs"]["end"]["distance"] == 7
    )
    assert (
        r["start"]["pos_team"]["id"] == "1" and r["end"]["def_pos_team"]["name"] == "B"
    )
    assert r["start"]["shortDownDistanceText"] == "1st & 10"
    for gone in (
        "clock.displayValue",
        "type.id",
        "start.down",
        "expectedPoints.before",
        "winProbability.before",
        "scoringType.name",
    ):
        assert gone not in r
    assert r["some_nan"] is None
    assert r["text"] == "rush for 3 yards"  # untouched passthrough


def test_reshape_tolerates_missing_optional_text_fields():
    # ESPN omits these on kickoff-only payloads; sdv-py then has no such column.
    rec = _record()
    for k in (
        "start.shortDownDistanceText",
        "start.possessionText",
        "end.shortDownDistanceText",
        "end.possessionText",
        "end.downDistanceText",
    ):
        del rec[k]
    app._reshape_records([rec])
    assert rec["start"]["shortDownDistanceText"] is None
    assert rec["end"]["downDistanceText"] is None
