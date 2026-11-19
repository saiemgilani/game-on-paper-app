"""The CFB roster's per-athlete fan-out (pre-2014 games) shares one time budget (app.ROSTER_BUDGET_S)."""

import json
import time

import polars as pl
import pytest
import requests
from requests.adapters import HTTPAdapter
from sportsdataverse import _espn_game_rosters
from sportsdataverse.dl_utils import download
from sportsdataverse.errors import NoDataError


@pytest.fixture(autouse=True)
def app(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    return app_mod


def _slow_espn(monkeypatch, delay):
    """Every request takes `delay` seconds and answers one athlete; returns the list of URLs sent."""
    sent = []

    def send(self, req, **kwargs):
        sent.append(req.url)
        time.sleep(delay)
        r = requests.Response()
        r.status_code, r.url = 200, req.url
        aid = req.url.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
        r._content = json.dumps(
            {
                "id": aid,
                "uid": f"u{aid}",
                "guid": f"g{aid}",
                "type": "football",
                "fullName": f"P {aid}",
                "displayName": f"P {aid}",
            }
        ).encode()
        r.headers["Content-Type"] = "application/json"
        return r

    monkeypatch.setattr(HTTPAdapter, "send", send)
    monkeypatch.setenv("SDV_PY_CACHE", "off")
    return sent


def test_athlete_fan_out_stops_at_the_budget(monkeypatch, app):
    sent = _slow_espn(monkeypatch, 0.05)
    hrefs = [
        f"http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2005/athletes/{i}"
        for i in range(1000, 1040)
    ]
    start = time.monotonic()
    got = _espn_game_rosters.athlete_items(
        pl.DataFrame({"athlete_href": hrefs}), session=app._DeadlineSession(0.3)
    )
    took = time.monotonic() - start
    # ~6 of the 40 athletes fit in 0.3 s; the rest are skipped at once, not fetched or retried
    assert 3 <= len(sent) <= 10, sent
    assert got.height == len(sent)
    assert took < 1.0, took


def test_a_spent_budget_neither_sends_nor_waits(monkeypatch, app):
    sent = _slow_espn(monkeypatch, 0)
    monkeypatch.setenv("SDV_PY_HTTP_RETRIES", "3")
    s = app._DeadlineSession(0)
    start = time.monotonic()
    with pytest.raises(NoDataError):
        download("http://sports.core.api.espn.com/v2/x", session=s)
    assert sent == []
    assert time.monotonic() - start < 0.1


def test_bounded_roster_passes_the_budget_and_never_raises(monkeypatch, app):
    seen = {}

    def entries(game_id, session=None):
        seen["session"] = session
        return "roster"

    monkeypatch.setattr(app, "_game_roster_entries", entries)
    assert app._bounded_roster(252810251) == "roster"
    assert isinstance(seen["session"], app._DeadlineSession)
    assert seen["session"].deadline - time.monotonic() <= app.ROSTER_BUDGET_S

    def broken(game_id, session=None):
        raise NoDataError("competitors 404")

    monkeypatch.setattr(app, "_game_roster_entries", broken)
    # an empty roster, not None: None would send the processor to fetch it again with no budget
    assert app._bounded_roster(252810251) == []
