# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "requests",
# ]
# ///
"""Build astro/src/static/teams.json: the CFB team index (the matchup builder's selects, /team, the sitemap).

Source: the Data API's `cfb.team_summaries`. A team is listed for exactly the seasons it has a row there,
2004 through METRIC_YEAR (astro/src/utils/constants.ts: the latest season the season tables cover, which
CURRENT_YEAR runs ahead of in the preseason), so a season bump picks up FBS newcomers (#333)
and never lists a season the season tables cannot render (Western Kentucky 2007, an FCS transition year).
Names and abbreviations already in the file are kept; a new team's come from `cfb.team_info`.

Run from the repo root:  SDV_AUTH_TOKEN=... uv run scripts/update_teams.py
`--check` writes nothing and exits 1 when the file's team-seasons differ from the source (CI runs it).
"""

import json
import os
import re
import sys
import time

import requests

API = "https://data.sportsdataverse.org/v1/cfb"
OUT = "./astro/src/static/teams.json"
CONSTANTS = "./astro/src/utils/constants.ts"
FIRST_SEASON = 2004  # AVAILABLE_SEASONS in astro/src/utils/constants.ts

session = requests.Session()
session.headers["Authorization"] = f"Bearer {os.environ['SDV_AUTH_TOKEN']}"


def get(table: str, **params) -> list[dict]:
    # a 5xx, a 429 or a dropped connection is retried with backoff; the last attempt raises
    for attempt in range(4):
        try:
            r = session.get(f"{API}/{table}", params=params, timeout=60)
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()
                return r.json()["data"]
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 3:
                raise
        time.sleep(2**attempt)
    r.raise_for_status()
    return []


def metric_year() -> int:
    with open(CONSTANTS, encoding="utf-8") as f:
        return int(re.search(r"export const METRIC_YEAR = (\d{4});", f.read())[1])


def source_seasons() -> dict[int, list[int]]:
    seasons: dict[int, list[int]] = {}
    for season in range(FIRST_SEASON, metric_year() + 1):
        # ponytail: one page per season; FBS is ~140 teams, the limit leaves room
        rows = get("team_summaries", season=season, select="team_id,season", limit=1000)
        if not rows:
            sys.exit(
                f"cfb.team_summaries has no {season} rows: is the season ingested?"
            )
        for row in rows:
            seasons.setdefault(int(row["team_id"]), []).append(season)
    return seasons


def main() -> None:
    with open(OUT, encoding="utf-8") as f:
        current = {t["team_id"]: t for t in json.load(f)["teams"]}
    seasons = source_seasons()

    if "--check" in sys.argv:
        drift = [
            f"{tid} {current.get(tid, {}).get('name', '?')}: file {current.get(tid, {}).get('seasons', [])} source {seasons.get(tid, [])}"
            for tid in sorted(current.keys() | seasons.keys())
            if current.get(tid, {}).get("seasons", []) != sorted(seasons.get(tid, []))
        ]
        if drift:
            print(
                f"{OUT} differs from cfb.team_summaries; run: uv run scripts/update_teams.py",
                *drift,
                sep="\n",
            )
            sys.exit(1)
        print(f"{OUT} matches cfb.team_summaries ({len(seasons)} teams)")
        return

    teams = []
    for tid in sorted(seasons):
        known = current.get(tid)
        if known is None:
            info = get("team_info", team_id=tid, limit=1)[0]
            known = {"name": info["school"], "abbr": info["abbreviation"]}
        teams.append(
            {
                "team_id": tid,
                "name": known["name"],
                "abbr": known["abbr"],
                "seasons": sorted(seasons[tid]),
            }
        )
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps({"teams": teams}, indent=4, ensure_ascii=False))
    print(f"wrote {len(teams)} teams to {OUT}")


if __name__ == "__main__":
    main()
