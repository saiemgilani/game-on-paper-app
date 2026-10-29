"""_game_roster: the CFB roster from Core v2's two team-roster pages, fail-open."""
import os

os.environ.setdefault("PYTHON_HTTP_TOKEN", "secret")
import app  # noqa: E402

BASE = app._CORE_COMPETITORS.format(gid=401871058)
PAGES = {
    BASE: {"items": [{"$ref": f"{BASE}/338?lang=en"}, {"$ref": f"{BASE}/2393?lang=en"}]},
    f"{BASE}/338/roster": {"entries": [
        {"playerId": 5265490, "displayName": "T. Lawson", "position": {"$ref": "http://x/positions/7?lang=en"}},
        {"playerId": 0, "displayName": "TEAM"},
    ]},
    f"{BASE}/2393/roster": {"entries": [{"playerId": 5220395, "displayName": "K. Smith"}]},
}


class _Resp:
    def __init__(self, body):
        self.body = body

    def json(self):
        return self.body


def test_one_row_per_rostered_athlete_with_its_team(monkeypatch):
    calls = []
    monkeypatch.setattr(app.requests, "get", lambda url, **k: calls.append(k["timeout"]) or _Resp(PAGES[url]))
    assert app._game_roster(401871058) == [
        {"athlete_id": 5265490, "team_id": "338", "full_name": "T. Lawson", "position_href": "http://x/positions/7?lang=en"},
        {"athlete_id": 5220395, "team_id": "2393", "full_name": "K. Smith", "position_href": None},
    ]
    assert calls == [5, 5, 5]  # three bounded requests, not one per athlete


def test_a_failed_fetch_is_an_empty_roster_not_none(monkeypatch):
    # None would send CFBPlayProcess to its own per-athlete fetch
    def boom(url, **k):
        raise TimeoutError("espn")

    monkeypatch.setattr(app.requests, "get", boom)
    assert app._game_roster(401871058) == []
