"""`POST /cfb/playoff/projection` and the 2026 CFP rules it applies on top of sdv-py's sims."""

import base64
import importlib
import itertools
import math

import numpy as np
import pytest

import playoff_projection as pp

MODEL = pp.Model(scale=48.4590, hfa=2.7110, sd=17.1697)


def rows_for(order, conf=None, champs=()):
    """`select_field` rows for teams listed best first."""
    conf = conf or {}
    return {t: (-i, conf.get(t, "SEC"), t in champs) for i, t in enumerate(order)}


def test_p4_champions_are_in_and_one_ranked_outside_12_takes_the_last_seed():
    order = [f"t{i}" for i in range(1, 31)]
    conf = {
        "t1": "SEC",
        "t2": "Big Ten",
        "t3": "ACC",
        "t20": "Big 12",
        "t25": "Sun Belt",
    }
    seeds, last_out, auto = pp.select_field(
        rows_for(order, conf, champs={"t1", "t2", "t3", "t20", "t25"})
    )
    assert len(seeds) == 12
    assert auto == {"t1", "t2", "t3", "t20", "t25"}
    # straight seeding inside the top 12, then the automatic qualifiers ranked below it
    assert seeds == [
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
        "t6",
        "t7",
        "t8",
        "t9",
        "t10",
        "t20",
        "t25",
    ]
    assert last_out == ["t11", "t12", "t13", "t14"]


def test_only_the_highest_ranked_g6_champion_gets_the_fifth_bid():
    order = [f"t{i}" for i in range(1, 31)]
    conf = {
        "t1": "SEC",
        "t2": "Big Ten",
        "t3": "ACC",
        "t4": "Big 12",
        "t15": "Mountain West",
        "t16": "Sun Belt",
    }
    seeds, _, auto = pp.select_field(
        rows_for(order, conf, champs={"t1", "t2", "t3", "t4", "t15", "t16"})
    )
    assert "t15" in seeds and "t16" not in seeds
    assert auto == {"t1", "t2", "t3", "t4", "t15"}


def test_notre_dame_is_automatic_only_inside_the_top_12():
    nd = pp.NOTRE_DAME
    inside = ["a", "b", nd] + [f"t{i}" for i in range(30)]
    _, _, auto = pp.select_field(rows_for(inside, {nd: None}))
    assert nd in auto
    outside = [f"t{i}" for i in range(12)] + [nd] + [f"u{i}" for i in range(10)]
    seeds, last_out, auto = pp.select_field(rows_for(outside, {nd: None}))
    assert nd not in auto and nd not in seeds and last_out[0] == nd


def test_a_conference_champion_outside_p4_and_g6_is_not_automatic():
    order = [f"t{i}" for i in range(30)]
    _, _, auto = pp.select_field(rows_for(order, {"t20": None}, champs={"t20"}))
    assert auto == set()


def test_the_bracket_is_fixed_and_the_exact_odds_add_up():
    ratings = {f"s{i}": 0.30 - 0.02 * i for i in range(1, 13)}
    reach = pp._bracket_probs(list(ratings), ratings, MODEL)
    for rnd, teams in (
        ("quarterfinal", 8),
        ("semifinal", 4),
        ("final", 2),
        ("champion", 1),
    ):
        assert sum(r[rnd] for r in reach.values()) == pytest.approx(teams)
    # a bye seed is in the quarterfinal; 1 and 8/9 share a quarterfinal, so 1 never meets 4 before the semifinal
    assert reach[1]["quarterfinal"] == 1.0 and reach[5]["quarterfinal"] < 1.0


def test_the_simulated_bracket_matches_the_exact_odds():
    ratings = {f"s{i}": 0.30 - 0.02 * i for i in range(1, 13)}
    exact = pp._bracket_probs(list(ratings), ratings, MODEL)
    n = 40000
    seeds = np.array([list(ratings)] * n, dtype=object)
    r = np.array([list(ratings.values())] * n)
    champ = pp._sim_bracket(seeds, r, MODEL, np.random.default_rng(1))
    sim = np.bincount(champ, minlength=12) / n
    for s in range(1, 13):
        assert sim[s - 1] == pytest.approx(exact[s]["champion"], abs=0.01)


def _league():
    """Five 4-team conferences, a round robin in each (half of it played), one ND game."""
    confs = ["SEC", "Big Ten", "ACC", "Big 12", "Sun Belt"]
    teams, games, tid = [], [], itertools.count(100)
    for c in confs:
        ids = [next(tid) for _ in range(4)]
        teams += [
            {
                "team_id": i,
                "pos_team": f"T{i}",
                "conference": c,
                "net_adj_epa": 0.3 - 0.003 * (i - 100),
            }
            for i in ids
        ]
        for k, (h, a) in enumerate(itertools.combinations(ids, 2)):
            done = k < 3
            games.append(
                {
                    "week": k + 1,
                    "season_type": "regular",
                    "completed": done,
                    "neutral_site": False,
                    "home_id": h,
                    "away_id": a,
                    "home_points": 28 if done else None,
                    "away_points": 21 if done else None,
                }
            )
    teams.append(
        {
            "team_id": 87,
            "pos_team": "Notre Dame",
            "conference": "FBS Independents",
            "net_adj_epa": 0.25,
        }
    )
    games.append(
        {
            "week": 6,
            "season_type": "regular",
            "completed": False,
            "neutral_site": True,
            "home_id": 87,
            "away_id": 999,
            "home_points": None,
            "away_points": None,
        }
    )  # an FCS opponent
    return {
        "season": 2026,
        "sims": 100,
        "seed": 3,
        "model": {"scale": 48.4590, "hfa": 2.7110, "sd": 17.1697},
        "teams": teams,
        "games": games,
    }


def test_project_on_a_small_league():
    out = pp.project(_league())
    assert out["sims"] == 100
    assert [f["seed"] for f in out["field"]] == list(range(1, 13))
    by_id = {t["team_id"]: t for t in out["teams"]}
    assert "999" not in by_id  # FCS teams are opponents, never rows
    assert sum(t["playoff"] for t in out["teams"]) == pytest.approx(12)
    assert sum(t["champion"] for t in out["teams"]) == pytest.approx(1)
    for c in ("SEC", "Big Ten", "ACC", "Big 12", "Sun Belt"):
        assert sum(
            t["conf_title"] for t in out["teams"] if t["conference"] == c
        ) == pytest.approx(1)
    # Notre Dame's one game left is against FCS on a neutral field: win-out is that game's exact odds
    nd = by_id["87"]
    assert nd["record"] == [0, 0]
    floor = min(t["net_adj_epa"] for t in _league()["teams"]) - pp.FCS_RATING_GAP
    assert nd["win_out"] == pytest.approx(
        0.5 * (1 + math.erf(MODEL.margin(0.25, floor, True) / MODEL.sd / math.sqrt(2)))
    )
    # the first team played three home wins; its record counts them
    assert by_id["100"]["record"] == [3, 0]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as mod

    importlib.reload(mod)
    return mod.app.test_client()


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def test_the_route_is_authenticated_and_rejects_a_bad_payload(client):
    assert client.post("/cfb/playoff/projection", json=_league()).status_code == 401
    assert (
        client.post(
            "/cfb/playoff/projection", json={"season": 2026}, headers=auth()
        ).status_code
        == 400
    )


def test_the_route_answers_the_projection(client):
    res = client.post("/cfb/playoff/projection", json=_league(), headers=auth())
    assert res.status_code == 200
    body = res.get_json()
    assert len(body["field"]) == 12 and len(body["last_out"]) <= 4


def test_seed_1_meets_seed_4_in_the_semifinal_and_seed_2_only_in_the_final():
    even = {f"s{i}": 0.1 for i in range(1, 13)}
    strong4 = dict(even, s4=2.0)
    base = pp._bracket_probs(list(even), even, MODEL)
    rigged = pp._bracket_probs(list(strong4), strong4, MODEL)
    assert rigged[1]["semifinal"] == pytest.approx(base[1]["semifinal"])
    assert rigged[1]["final"] < 0.01
    assert rigged[2]["final"] == pytest.approx(base[2]["final"])


def test_a_simulated_game_is_won_at_the_model_s_odds():
    # a near-even game, where a margin that rounds to 0 matters: it must go by its sign,
    # not to the favourite, or the favourite wins more often than win_prob says
    import polars as pl

    ratings = {"a": 0.005, "b": 0.0}
    n = 100_000  # ~0.16 pt SE; the favourite bias this guards is ~1.2 pt
    games = pl.DataFrame(
        {
            "week": [1] * n,
            "home_team": ["a"] * n,
            "away_team": ["b"] * n,
            "result": [None] * n,
            "neutral": [1] * n,
        },
        schema={"week": pl.Int64, "home_team": pl.Utf8, "away_team": pl.Utf8, "result": pl.Float64, "neutral": pl.Int64},
    )
    out = pp._compute_results(ratings, MODEL)(None, games, 1, rng=np.random.default_rng(7))
    res = out["games"]["result"]
    assert (res == 0).sum() == 0
    assert abs((res > 0).mean() - MODEL.win_prob(0.005, 0.0, True)) < 0.006
