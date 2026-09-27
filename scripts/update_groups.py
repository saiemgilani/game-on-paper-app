# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "polars>=1.0,<2.0",
#     "requests",
# ]
# ///
"""Build astro/src/static/season_groups.json: the scoreboard's conference list for each season.

Source: the sportsdataverse-data `cfb_groups` release. `cfb_group_seasons` gives each conference's
label and member count as of each season; `cfb_group_aliases` (source == "espn") gives the ESPN
group id valid in that season. ESPN reuses and back-labels its ids (179 is the OVC lineage, shown
as "Big South-OVC" in 2023-24), so the label comes from SDV and only the id from ESPN.

Run from the repo root:  uv run scripts/update_groups.py
"""

import io
import json

import polars as pl
import requests

RELEASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/cfb_groups"
OUT = "./astro/src/static/season_groups.json"
FIRST_SEASON = 2004  # AVAILABLE_SEASONS in astro/src/utils/constants.ts

# GOP's labels where they differ from SDV's short_name for that season.
HOUSE_LABELS = {
    "Conference USA": "C-USA",
    "Mid-American": "MAC",
    "Atlantic Sun": "ASUN",
    "Metro Atlantic Athletic": "MAAC",
    "AWC": "ASUN-WAC",
}

# ESPN structural groups the scoreboard keeps around the conference blocks (-1 = Top 25 filter).
FBS_HEAD = [{"id": 80, "name": "FBS (I-A)"}, {"id": -1, "name": "Top 25"}]
FCS_HEAD = [{"id": 81, "name": "FCS (I-AA)"}]
TAIL = [{"id": 90, "name": "All Division I"}, {"id": 35, "name": "Div II/III"}]


def read(table: str) -> pl.DataFrame:
    resp = requests.get(f"{RELEASE}/{table}.parquet", timeout=60)
    resp.raise_for_status()
    return pl.read_parquet(io.BytesIO(resp.content))


def build(group_seasons: pl.DataFrame, aliases: pl.DataFrame) -> dict[str, list[dict]]:
    espn = (
        aliases.filter(pl.col("source") == "espn")
        .select(
            "group_id",
            pl.col("source_id").cast(pl.Int64).alias("id"),
            "valid_from",
            "valid_to",
        )
        .unique()
    )
    confs = (
        group_seasons.filter(
            pl.col("level") == "conference",
            pl.col("parent_group_id").is_in(["cfb:fbs", "cfb:fcs"]),
            pl.col("n_teams") > 0,
            pl.col("season") >= FIRST_SEASON,
        )
        .join(espn, on="group_id", how="inner")
        .filter(
            pl.col("season") >= pl.col("valid_from"),
            pl.col("valid_to").is_null() | (pl.col("season") <= pl.col("valid_to")),
        )
        .with_columns(pl.col("short_name").replace(HOUSE_LABELS).alias("name"))
        .select("season", "parent_group_id", "id", "name")
    )
    dupes = confs.filter(pl.struct("season", "id").is_duplicated())
    if dupes.height:
        raise ValueError(
            f"an ESPN group id maps to two conferences in one season:\n{dupes}"
        )

    out: dict[str, list[dict]] = {}
    for season in range(FIRST_SEASON, group_seasons["season"].max() + 1):
        rows = confs.filter(pl.col("season") == season)

        def block(parent: str) -> list[dict]:
            # GOP's order: plain (case-sensitive) sort of the labels, so "SWAC" precedes "Southern"
            return sorted(
                (
                    {"id": r["id"], "name": r["name"]}
                    for r in rows.filter(pl.col("parent_group_id") == parent).iter_rows(
                        named=True
                    )
                ),
                key=lambda g: g["name"],
            )

        out[str(season)] = (
            FBS_HEAD + block("cfb:fbs") + FCS_HEAD + block("cfb:fcs") + TAIL
        )
    return out


if __name__ == "__main__":
    result = build(read("cfb_group_seasons"), read("cfb_group_aliases"))
    with open(OUT, "w") as f:
        f.write(json.dumps(result, indent=1) + "\n")
    print(f"wrote {OUT}: seasons {min(result)}-{max(result)}")
