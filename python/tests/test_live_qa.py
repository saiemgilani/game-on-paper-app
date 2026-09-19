"""Live-poll rules, against real captured timelines.

Every fixture under ``tests/fixtures/live-states`` is a real slice of a real
game's poll history (``scripts/capture_game_states.py``, see that directory's
README), trimmed to the fields ``live_qa`` reads. Two of the three were
captured misbehaving, so the prefix, score, period and clock rules are asserted
against the actual ESPN payloads that broke them rather than against anything
written here. The rules a raw ESPN capture cannot carry (win probability and
timeouts, which sdv-py derives) are asserted by mutating a real pair -- and so
is every other rule, from the same starting point that must first pass clean,
which is what makes each assertion a mutation test rather than a hopeful one.
"""

import copy
import gzip
import json
from pathlib import Path

import pytest

import live_qa

FIXTURES = Path(__file__).parent / "fixtures" / "live-states"


def states(game_id):
    with gzip.open(FIXTURES / f"{game_id}.json.gz", "rt", encoding="utf-8") as fh:
        return json.load(fh)["states"]


def pair(game_id, a, b):
    """The payloads of two captured polls, by seq."""
    by_seq = {s["seq"]: s["payload"] for s in states(game_id)}
    return by_seq[a], by_seq[b]


def rules(result):
    return {f["rule"] for f in result["findings"]}


def counts(result):
    return {f["rule"]: f["n"] for f in result["findings"]}


def check(prev, curr):
    return live_qa.validate_live(live_qa.summarize(prev), curr)


# --- the real captures -------------------------------------------------------

@pytest.mark.parametrize("game_id,a,b", [
    ("401856682", 1, 2),    # in progress, two polls apart
    ("401856682", 3, 4),    # halftime, nothing moving
    ("401856682", 23, 24),  # 4th quarter, clock running down
    ("401866532", 7, 8),    # the recovery poll after the regression
])
def test_a_healthy_pair_of_polls_is_clean(game_id, a, b):
    prev, curr = pair(game_id, a, b)
    result = check(prev, curr)
    assert result["ok"], counts(result)


def test_espn_serving_an_older_payload_is_caught():
    # 401866532 seq 5 -> 6: 4th quarter 15-21 with 128 plays, then 3rd quarter
    # 8-21 with 99. The single most consequential thing the capture harness
    # found (docs/game-state-fixtures.md) and invisible from one sample.
    prev, curr = pair("401866532", 5, 6)
    result = check(prev, curr)
    assert not result["ok"]
    # the regressed payload DROPS 29 finished plays rather than rewriting them
    assert {"live.period_monotone", "live.score_monotone", "live.prefix_dropped"} <= rules(result)


def test_a_score_running_backwards_across_three_polls():
    # 401868962: 17-0 -> 7-0 -> 0-0, the probe that fired on 18 of 24 games
    first, second, third = (s["payload"] for s in states("401868962")[:3])
    assert "live.score_monotone" in rules(check(first, second))
    assert "live.score_monotone" in rules(check(second, third))
    # ...and the recovery back to 17-0 is not a violation of anything
    assert check(third, states("401868962")[3]["payload"])["ok"]


def test_the_phase_may_go_in_to_halftime_and_back():
    by_seq = {s["seq"]: s["payload"] for s in states("401856682")}
    assert check(by_seq[2], by_seq[3])["ok"]   # in progress -> halftime
    assert check(by_seq[4], by_seq[23])["ok"]  # halftime -> in progress


def test_the_final_poll_only_adds_rows():
    # 401856682 seq 24 -> 25: the last in-progress poll (182 plays) to FINAL
    # (188). Rows are appended and none of the finished ones move, which is
    # what a healthy close-out looks like -- and the baseline the regressed
    # payloads above are a violation OF.
    prev, curr = pair("401856682", 24, 25)
    assert check(prev, curr)["ok"]


# --- one mutation per rule ---------------------------------------------------
# Each starts from a pair that passes clean above, so a rule that fired for
# another reason would fail the `clean` assertion instead of passing silently.

@pytest.fixture
def clean():
    prev, curr = pair("401856682", 23, 24)
    assert check(prev, curr)["ok"], "the mutation baseline must start clean"
    return copy.deepcopy(prev), copy.deepcopy(curr)


def test_prefix_changed_fires_when_a_finished_play_is_rewritten(clean):
    prev, curr = clean
    curr["plays"][5]["text"] = "rewritten after the fact"
    assert counts(check(prev, curr))["live.prefix_changed"] == 1


def test_prefix_dropped_fires_when_a_finished_play_vanishes(clean):
    prev, curr = clean
    del curr["plays"][5]
    assert counts(check(prev, curr))["live.prefix_dropped"] == 1


def test_a_revision_the_source_tags_is_counted_not_failed(clean):
    prev, curr = clean
    curr["plays"][5]["text"] = "rewritten after the fact"
    curr["plays"][5]["modified"] = "2026-09-13T04:00Z"  # ...and tagged as revised
    result = check(prev, curr)
    assert result["ok"] and counts(result) == {"live.prefix_revised": 1}


def test_clock_running_backwards_within_a_period(clean):
    prev, curr = clean
    curr["header"]["competitions"][0]["status"]["displayClock"] = "14:59"
    assert "live.clock_monotone" in rules(check(prev, curr))


def test_the_period_never_decreases(clean):
    prev, curr = clean
    curr["header"]["competitions"][0]["status"]["period"] = 2
    assert "live.period_monotone" in rules(check(prev, curr))


def test_the_phase_never_goes_back(clean):
    prev, curr = clean
    prev["header"]["competitions"][0]["status"]["type"]["state"] = "post"
    assert "live.phase_order" in rules(check(prev, curr))


def test_the_score_never_decreases(clean):
    prev, curr = clean
    curr["header"]["competitions"][0]["competitors"][0]["score"] = "0"
    assert "live.score_monotone" in rules(check(prev, curr))


def test_a_null_play_type(clean):
    prev, curr = clean
    curr["plays"][-1]["type"]["id"] = None
    assert "live.type_null" in rules(check(prev, curr))


def test_the_top_rows_end_state_must_be_derived(clean):
    prev, curr = clean
    top = curr["plays"][-1]
    top["statYardage"] = 7
    top["end"] = {**top["end"], **{k: top["start"][k] for k in ("down", "distance", "yardsToEndzone")}}
    assert "live.end_state_derived" in rules(check(prev, curr))


def test_win_probability_moving_on_a_row_that_did_not_change(clean):
    prev, curr = clean
    for i in (3, 4, 5):  # sdv-py supplies these; a raw ESPN capture has none
        prev["plays"][i]["wp_before"], prev["plays"][i]["wp_after"] = 0.5, 0.55
        curr["plays"][i]["wp_before"], curr["plays"][i]["wp_after"] = 0.5, 0.55
    assert check(prev, curr)["ok"]
    curr["plays"][4]["wp_after"] = 0.61
    result = check(prev, curr)
    assert counts(result)["live.wp_continuity"] == 1
    assert "live.prefix_changed" not in rules(result)  # the row itself is unchanged


def test_timeouts_never_increase_within_a_half(clean):
    prev, curr = clean
    prev["plays"][-1]["start.homeTeamTimeouts"] = 1
    curr["plays"][-1]["start.homeTeamTimeouts"] = 1
    assert check(prev, curr)["ok"]
    curr["plays"][-1]["start.homeTeamTimeouts"] = 2
    assert "live.timeouts_increased" in rules(check(prev, curr))


def test_timeouts_reset_at_the_half(clean):
    prev, curr = clean
    prev["plays"][-1]["start.homeTeamTimeouts"] = 0
    curr["plays"][-1]["start.homeTeamTimeouts"] = 3
    curr["header"]["competitions"][0]["status"]["period"] = 5  # overtime
    assert "live.timeouts_increased" not in rules(check(prev, curr))


# --- the stateful wrapper ----------------------------------------------------

def test_track_remembers_the_previous_poll_and_counts_them():
    live_qa._STATE.clear()
    seq = [s["payload"] for s in states("401866532")]
    first = live_qa.track("401866532", seq[0])
    assert first["polls"] == 1 and first["ok"]
    for p in seq[1:]:
        last = live_qa.track("401866532", p)
    assert last["polls"] == len(seq)
    assert last["since"] == first["since"]
    # seq 5 -> 6 is the regression, so the run cannot have been clean throughout
    assert not live_qa.track("401866532", seq[2])["ok"]


def test_track_is_bounded_and_never_raises():
    live_qa._STATE.clear()
    payload = states("401868962")[0]["payload"]
    for i in range(live_qa._MAX_TRACKED + 5):
        live_qa.track(i, payload)
    assert len(live_qa._STATE) == live_qa._MAX_TRACKED
    assert live_qa.track("x", {"plays": None, "header": "not a dict"}) is None
