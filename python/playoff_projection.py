"""CFB playoff projection: sportsdataverse-py season sims + the 2026 CFP rules.

sportsdataverse-py's ``cfb_simulations`` plays out the rest of the regular season and
the conference title games (its cfbseedR tiebreakers pick each title game). This module
replaces the two pieces that don't match the 2026 playoff:

* selection: sdv-py takes the five highest-ranked conference champions (the 2025 rule).
  In 2026 the four P4 champions are in, plus the highest-ranked champion of the other six
  conferences, plus Notre Dame when it ranks in the top 12; the rest are at-large. An
  automatic qualifier ranked outside the top 12 takes the lowest seeds.
* the bracket: sdv-py reseeds every round. The CFP bracket is fixed (1 v 8/9, 2 v 7/10,
  3 v 6/11, 4 v 5/12; no reseeding), with first-round games at the higher seed.

Every game, simulated or projected, is priced by GOP's fitted pregame model on the team
summaries' net_adj_epa, so a matchup here reads the same as on the game page. Ratings
stay fixed through a simulated season.
"""

import math

import numpy as np
import polars as pl
from sportsdataverse.cfb.cfb_simulations import cfb_simulations

P4 = ("ACC", "Big Ten", "Big 12", "SEC")
G6 = (
    "American Athletic",
    "Conference USA",
    "Mid-American",
    "Mountain West",
    "Pac-12",
    "Sun Belt",
)
NOTRE_DAME = "87"
FIELD = 12
LAST_OUT = 4
# ponytail: committee stand-in = rating minus a fixed price per loss. 0.08 net_adj_epa is
# about 3.9 points of margin: a one-loss team outranks an equal two-loss team, and a
# four-loss team needs a much better rating to get in. Fit it to past CFP rankings if the
# committee's order ever matters beyond who's in.
LOSS_PENALTY = 0.08
# FCS opponents have no net_adj_epa; price them below every FBS team.
FCS_RATING_GAP = 0.15
SIMS = 1000  # ~10 s on one core; the tiebreakers dominate (sdv-py cfb_standings runs twice)
SIMS_MAX = 10000
# first round: (higher seed, lower seed); quarterfinals: the bye seed and the first-round
# game it meets; semifinals: the quarterfinals that meet
FIRST_ROUND = ((5, 12), (6, 11), (7, 10), (8, 9))
QUARTERS = ((1, 3), (2, 2), (3, 1), (4, 0))  # (bye seed, index into FIRST_ROUND)
SEMIS = ((0, 3), (1, 2))  # indexes into QUARTERS


def _norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


class Model:
    """GOP's pregame model: margin = scale * (home - away) + hfa off neutral sites."""

    def __init__(self, scale, hfa, sd):
        self.scale, self.hfa, self.sd = float(scale), float(hfa), float(sd)

    def margin(self, home, away, neutral):
        return self.scale * (home - away) + (0.0 if neutral else self.hfa)

    def win_prob(self, home, away, neutral):
        return _norm_cdf(self.margin(home, away, neutral) / self.sd)


def _compute_results(ratings, model):
    """An sdv-py ``compute_results`` that prices each game with GOP's model."""
    rating_frame = pl.DataFrame({"team": list(ratings), "_r": list(ratings.values())})

    def compute(teams, games, week_num, *, rng, **_):
        g = (
            games.join(
                rating_frame.rename({"team": "home_team", "_r": "_rh"}),
                on="home_team",
                how="left",
            )
            .join(
                rating_frame.rename({"team": "away_team", "_r": "_ra"}),
                on="away_team",
                how="left",
            )
            .with_columns(
                (
                    model.scale * (pl.col("_rh") - pl.col("_ra"))
                    + pl.when(pl.col("neutral") == 0).then(model.hfa).otherwise(0.0)
                ).alias("_m")
            )
        )
        draw = g["_m"].to_numpy() + rng.normal(0.0, model.sd, g.height)
        # no ties: a drawn 0 goes to the favourite
        draw = np.where(
            np.round(draw) == 0,
            np.sign(g["_m"].to_numpy()) + (g["_m"].to_numpy() == 0),
            np.round(draw),
        )
        g = g.with_columns(
            pl.when((pl.col("week") == week_num) & pl.col("result").is_null())
            .then(pl.Series("_s", draw, dtype=pl.Float64))
            .otherwise(pl.col("result"))
            .alias("result")
        )
        return {"teams": teams, "games": g.select(games.columns)}

    return compute


def _inputs(payload):
    """Engine frames + ratings from the request (Data API schedule + team summaries)."""
    fbs = {
        str(t["team_id"]): t
        for t in payload["teams"]
        if t.get("net_adj_epa") is not None
    }
    floor = min(t["net_adj_epa"] for t in fbs.values()) - FCS_RATING_GAP
    rows, fcs = [], set()
    for g in payload["games"]:
        if g.get("season_type", "regular") != "regular":
            continue
        home, away = str(g["home_id"]), str(g["away_id"])
        fcs.update(t for t in (home, away) if t not in fbs)
        done = (
            bool(g.get("completed"))
            and g.get("home_points") is not None
            and g.get("away_points") is not None
        )
        rows.append(
            {
                "season": int(payload["season"]),
                "week": int(g["week"]),
                "game_type": "REG",
                "home_team": home,
                "away_team": away,
                "result": float(g["home_points"] - g["away_points"]) if done else None,
                "neutral": 1 if g.get("neutral_site") else 0,
            }
        )
    games = pl.DataFrame(
        rows,
        schema={
            "season": pl.Int64,
            "week": pl.Int64,
            "game_type": pl.Utf8,
            "home_team": pl.Utf8,
            "away_team": pl.Utf8,
            "result": pl.Float64,
            "neutral": pl.Int64,
        },
    )
    # FCS teams carry no conference, so the engine never builds them a title game
    teams = pl.DataFrame(
        {
            "team": list(fbs) + sorted(fcs),
            "conference": [
                t["conference"] if t["conference"] != "FBS Independents" else None
                for t in fbs.values()
            ]
            + [None] * len(fcs),
        },
        schema={"team": pl.Utf8, "conference": pl.Utf8},
    )
    ratings = {k: float(t["net_adj_epa"]) for k, t in fbs.items()} | {
        k: floor for k in fcs
    }
    return games, teams, ratings, fbs


def select_field(rows):
    """The 2026 field from one season's outcome.

    ``rows``: ``{team: (score, conference, conf_champ)}`` for FBS teams, ``score`` being the
    committee stand-in (higher is better). Returns ``(seeds, last_out, auto)``: team ids, seed 1 first; ``auto`` the automatic qualifiers.
    """
    order = sorted(rows, key=lambda t: -rows[t][0])
    rank = {t: i + 1 for i, t in enumerate(order)}
    auto = [t for t in order if rows[t][2] and rows[t][1] in P4]
    g6 = [t for t in order if rows[t][2] and rows[t][1] in G6]
    auto += g6[:1]
    if NOTRE_DAME in rank and rank[NOTRE_DAME] <= FIELD:
        auto.append(NOTRE_DAME)
    rest = [t for t in order if t not in auto]
    at_large = rest[: FIELD - len(auto)]
    field = sorted(
        auto + at_large, key=lambda t: (t in auto and rank[t] > FIELD, rank[t])
    )
    return field, rest[FIELD - len(auto) : FIELD - len(auto) + LAST_OUT], set(auto)


def _bracket_probs(seeds, ratings, model):
    """Per-team round probabilities through a fixed bracket, exactly (no sampling)."""
    r = {s: ratings[t] for s, t in enumerate(seeds, start=1)}

    def p(a, b, home):
        return model.win_prob(r[a], r[b], neutral=not home)

    reach = {s: {"quarterfinal": 1.0 if s <= 4 else 0.0} for s in r}
    for hi, lo in FIRST_ROUND:
        reach[hi]["quarterfinal"] = p(hi, lo, True)
        reach[lo]["quarterfinal"] = 1.0 - reach[hi]["quarterfinal"]

    def advance(groups, src, dst):
        for a, b in groups:
            for s in a:
                reach[s][dst] = reach[s][src] * sum(
                    reach[o][src] * p(s, o, False) for o in b
                )
            for s in b:
                reach[s][dst] = reach[s][src] * sum(
                    reach[o][src] * p(s, o, False) for o in a
                )

    qf = [((bye,), FIRST_ROUND[i]) for bye, i in QUARTERS]
    advance(qf, "quarterfinal", "semifinal")
    sf_sides = [qf[i][0] + qf[i][1] for i in range(4)]
    advance([(sf_sides[a], sf_sides[b]) for a, b in SEMIS], "semifinal", "final")
    final_sides = [sf_sides[a] + sf_sides[b] for a, b in SEMIS]
    advance([tuple(final_sides)], "final", "champion")
    return reach


def _sim_bracket(seed_matrix, ratings_matrix, model, rng):
    """Play the fixed bracket for every sim at once; returns the champion's seed index per sim."""
    n = seed_matrix.shape[0]

    def play(a, b, home):
        # a, b: column indexes per sim (0-based seed positions)
        ra, rb = ratings_matrix[np.arange(n), a], ratings_matrix[np.arange(n), b]
        m = model.scale * (ra - rb) + (model.hfa if home else 0.0)
        win = rng.normal(m, model.sd) > 0
        return np.where(win, a, b)

    fr = [play(np.full(n, hi - 1), np.full(n, lo - 1), True) for hi, lo in FIRST_ROUND]
    qf = [play(np.full(n, bye - 1), fr[i], False) for bye, i in QUARTERS]
    sf = [play(qf[a], qf[b], False) for a, b in SEMIS]
    return play(sf[0], sf[1], False)


def project(payload):
    model = Model(**payload["model"])
    sims = max(100, min(int(payload.get("sims") or SIMS), SIMS_MAX))
    games, teams, ratings, fbs = _inputs(payload)
    rng = np.random.default_rng(int(payload.get("seed", 0)))
    out = cfb_simulations(
        games,
        teams,
        _compute_results(ratings, model),
        simulations=sims,
        sim_include="CONF",
        seed=int(payload.get("seed", 0)),
    )
    st = (
        out["standings"]
        .filter(pl.col("team").is_in(list(fbs)))
        .select(
            "sim",
            "team",
            "conference",
            "wins",
            "losses",
            pl.col("conf_champ").fill_null(False),
        )
        .with_columns(
            (
                pl.col("team").replace_strict(ratings, return_dtype=pl.Float64)
                - LOSS_PENALTY * pl.col("losses")
            ).alias("score")
        )
    )

    # each sim's field, seeded
    seeds = np.empty((sims, FIELD), dtype=object)
    for i, ((sim,), part) in enumerate(st.partition_by("sim", as_dict=True).items()):
        rows = {
            t: (s, c, ch)
            for t, s, c, ch in part.select(
                "team", "score", "conference", "conf_champ"
            ).iter_rows()
        }
        seeds[i] = select_field(rows)[0]
    ratings_matrix = np.vectorize(ratings.get)(seeds).astype(float)
    champ = seeds[np.arange(sims), _sim_bracket(seeds, ratings_matrix, model, rng)]

    seed_frame = pl.DataFrame(
        {
            "team": seeds.ravel().astype(str),
            "seed": np.tile(np.arange(1, FIELD + 1), sims),
        }
    )
    per_team = st.group_by("team").agg(
        pl.col("wins").mean().alias("wins"),
        pl.col("losses").mean().alias("losses"),
        pl.col("conf_champ").cast(pl.Float64).mean().alias("conf_title"),
    )
    seeded = seed_frame.group_by("team").agg(
        (pl.len() / sims).alias("playoff"),
        ((pl.col("seed") <= 4).sum() / sims).alias("bye"),
        pl.col("seed").mean().alias("avg_seed"),
    )
    champs = (
        pl.DataFrame({"team": champ.astype(str)})
        .group_by("team")
        .agg((pl.len() / sims).alias("champion"))
    )

    # win-out and current record are exact from the schedule
    played = games.filter(pl.col("result").is_not_null())
    left = games.filter(pl.col("result").is_null())
    record, win_out = {t: [0, 0] for t in fbs}, {t: 1.0 for t in fbs}
    for h, a, res in played.select("home_team", "away_team", "result").iter_rows():
        for t, won in ((h, res > 0), (a, res < 0)):
            if t in record:
                record[t][0 if won else 1] += 1
    for h, a, neu in left.select("home_team", "away_team", "neutral").iter_rows():
        ph = model.win_prob(ratings[h], ratings[a], bool(neu))
        if h in win_out:
            win_out[h] *= ph
        if a in win_out:
            win_out[a] *= 1.0 - ph

    table = (
        per_team.join(seeded, on="team", how="left")
        .join(champs, on="team", how="left")
        .with_columns(pl.col("playoff", "bye", "champion").fill_null(0.0))
        .sort(["playoff", "conf_title", "wins"], descending=True)
    )
    teams_out = [
        {
            "team_id": t,
            "name": fbs[t]["pos_team"],
            "conference": fbs[t]["conference"],
            "rating": ratings[t],
            "record": record[t],
            "win_out": win_out[t],
            **{k: v for k, v in row.items() if k != "team"},
        }
        for row in table.iter_rows(named=True)
        for t in [row["team"]]
    ]

    # the projected field: the same rules on the average season, each conference's
    # champion being its likeliest one
    likeliest = {}
    for row in teams_out:
        c = row["conference"]
        if c in P4 + G6 and row["conf_title"] > likeliest.get(c, (None, -1.0))[1]:
            likeliest[c] = (row["team_id"], row["conf_title"])
    champs_proj = {t for t, _ in likeliest.values()}
    rows = {
        r["team_id"]: (
            r["rating"] - LOSS_PENALTY * r["losses"],
            r["conference"],
            r["team_id"] in champs_proj,
        )
        for r in teams_out
    }
    field, last_out, auto = select_field(rows)
    reach = _bracket_probs(field, ratings, model)
    return {
        "season": int(payload["season"]),
        "sims": sims,
        "loss_penalty": LOSS_PENALTY,
        "field": [
            {
                "seed": i,
                "team_id": t,
                "auto": t in auto,
                "reach": reach[i],
            }
            for i, t in enumerate(field, start=1)
        ],
        "last_out": last_out,
        "teams": teams_out,
    }
