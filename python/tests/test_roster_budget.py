"""The CFB roster's per-athlete fan-out (pre-2014 games) shares one time budget (app.ROSTER_BUDGET_S)."""

import json
import time

import polars as pl
import pytest
import requests
from requests.adapters import HTTPAdapter
from sportsdataverse import _espn_game_rosters, dl_utils
from sportsdataverse.dl_utils import download
from sportsdataverse.errors import NoDataError


@pytest.fixture(autouse=True)
def app(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    return app_mod


class _Clock:
    """app's monotonic clock, advanced only by the fake ESPN below: the budget is checked exactly."""

    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now


def _slow_espn(monkeypatch, app, delay):
    """Every request takes `delay` seconds of app's fake clock and answers one athlete; returns
    the list of URLs sent and the clock. Retry waits are recorded, never slept."""
    sent, clock = [], _Clock()
    monkeypatch.setattr(app, "time", clock)
    monkeypatch.setattr(dl_utils.time, "sleep", lambda s: sent.append(f"sleep {s}"))

    def send(self, req, **kwargs):
        sent.append(req.url)
        clock.now += delay
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
    return sent, clock


def test_athlete_fan_out_stops_at_the_budget(monkeypatch, app):
    sent, clock = _slow_espn(monkeypatch, app, 0.05)
    hrefs = [
        f"http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2005/athletes/{i}"
        for i in range(1000, 1040)
    ]
    session = app._DeadlineSession(0.3)
    got = _espn_game_rosters.athlete_items(
        pl.DataFrame({"athlete_href": hrefs}), session=session
    )
    # 6 of the 40 athletes fit in 0.3 s; the other 34 are skipped at once, neither sent nor retried
    assert len(sent) == 6, sent
    assert got.height == 6
    assert session.skipped == 34
    assert clock.now == pytest.approx(0.3)


def test_a_spent_budget_neither_sends_nor_waits(monkeypatch, app):
    sent, _ = _slow_espn(monkeypatch, app, 0)
    monkeypatch.setenv("SDV_PY_HTTP_RETRIES", "3")
    with pytest.raises(NoDataError):
        download(
            "http://sports.core.api.espn.com/v2/x", session=app._DeadlineSession(0)
        )
    assert sent == []  # no request and no retry wait


def test_bounded_roster_passes_the_budget_and_never_raises(monkeypatch, app):
    seen = {}

    def entries(game_id, session=None):
        seen["session"] = session
        return "roster"

    monkeypatch.setattr(app, "_game_roster_entries", entries)
    assert app._bounded_roster(252810251) == "roster"
    assert isinstance(seen["session"], app._DeadlineSession)
    assert seen["session"].deadline - time.monotonic() <= app.ROSTER_BUDGET_S
    assert seen["session"].skipped == 0

    def broken(game_id, session=None):
        raise NoDataError("competitors 404")

    monkeypatch.setattr(app, "_game_roster_entries", broken)
    # an empty roster, not None: None would send the processor to fetch it again with no budget
    assert app._bounded_roster(252810251) == []


def test_a_spent_budget_is_logged(monkeypatch, app, caplog):
    def entries(game_id, session=None):
        session.deadline = 0  # spent: the next request is refused
        with pytest.raises(NoDataError):
            session.get("http://sports.core.api.espn.com/v2/athletes/1")
        return "partial"

    monkeypatch.setattr(app, "_game_roster_entries", entries)
    assert app._bounded_roster(252810251) == "partial"
    assert "252810251" in caplog.text and "1 athletes left unnamed" in caplog.text
