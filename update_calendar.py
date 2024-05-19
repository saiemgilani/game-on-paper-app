import requests
import pandas as pd
import json

base_url = "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"


def get_calendar(year: int):
    j = requests.get(f"{base_url}?dates={year}0901")
    calendar = j.json()['leagues'][0]['calendar']

    weeks = []
    for t in calendar:
        if t["value"] == "4":
            continue

        for e in t['entries']:
            e['year'] = f"{year}"
            weeks.append(e)
    result = {
        f"{year}" : weeks
    }

    print(json.dumps(result))

# update this to any arbitrary year and add it to frontend/cfb/schedule.json to update the weeks available in the switcher.
get_calendar(2024)