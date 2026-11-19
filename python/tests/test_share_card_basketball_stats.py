"""'bball-share-card': the basketball player and team cards (share_card.render_basketball_stats) and their route, offline.

The bodies are what astro basketball/statCard.ts builds from the producer's season rows (shot_season_players for a
player, team_strength for a team). Logos come from a stub, so nothing reaches ESPN.
"""

import importlib
import io

import pytest
from PIL import Image

import share_card
from tests.test_share_card_basketball import _logo, _Opener
from tests.test_usage_box_route import _auth

LOGO = "https://a.espncdn.com/i/teamlogos/nba/500/13.png"


def _player():
    return {
        "stamp": "NBA / 2026-27 regular season",
        "title": "Luka Dončić",
        "subtitle": "LAL / 12 GP / 35.9 MIN",
        "team": {
            "id": "13",
            "abbr": "LAL",
            "color": "552583",
            "alternateColor": "fdb927",
            "logo": LOGO,
        },
        "tiles": [
            {"value": "39.0", "label": "Points per game", "rank": None},
            {"value": "66.0%", "label": "TS%", "rank": None},
            {"value": "40.6%", "label": "3P%", "rank": "4th in the NBA"},
            {"value": "86.5%", "label": "FT%", "rank": "5th in the NBA"},
        ],
        "note": "Ranks: the producer's, among players over its attempt minimum",
    }


def test_player_card_draws_the_strings_it_is_sent():
    drawn = []
    png = share_card.render_basketball_stats(_player(), "nba", _logo, drawn)
    assert Image.open(io.BytesIO(png)).size == (1200, 630)
    for s in (
        "Luka Dončić",
        "LAL / 12 GP / 35.9 MIN",
        "39.0",
        "Points per game",
        "40.6%",
        "4th in the NBA",
        "gameonpaper.com",
    ):
        assert s in drawn
    # a tile with no producer rank draws no rank line
    assert "None" not in drawn


def test_team_card_without_tiles_or_logo_still_draws():
    body = {"title": "Brooklyn Nets", "team": {"id": "17", "abbr": "BKN"}, "tiles": []}
    drawn = []
    png = share_card.render_basketball_stats(body, "nba", lambda url: None, drawn)
    assert Image.open(io.BytesIO(png)).size == (1200, 630)
    assert "BKN" in drawn  # no logo: the abbreviation


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    monkeypatch.setattr(app_mod, "_LOGO_OPENER", _Opener())
    return app_mod, app_mod.app.test_client()


@pytest.mark.parametrize("league", ["nba", "wnba", "mbb", "wbb"])
@pytest.mark.parametrize("kind", ["players", "team"])
def test_route_draws_the_body_it_is_sent(client, league, kind):
    app_mod, c = client
    r = c.post(f"/{league}/{kind}/1629029/card.png", json=_player(), headers=_auth())
    assert r.status_code == 200, r.get_data(as_text=True)[:300]
    assert r.mimetype == "image/png"
    assert app_mod._LOGO_OPENER.opened == [LOGO]


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        {"team": {}},
        {"title": "x"},
        {"title": "x", "team": {}, "tiles": [{"value": 1, "label": "a"}]},
        {"title": "x", "team": {}, "tiles": [{"value": "1", "label": "a"}] * 5},
    ],
)
def test_route_rejects_a_malformed_body(client, body):
    _, c = client
    assert (
        c.post("/nba/players/1/card.png", json=body, headers=_auth()).status_code == 400
    )


def test_route_needs_the_token_and_a_known_kind(client):
    _, c = client
    assert c.post("/nba/players/1/card.png", json=_player()).status_code == 401
    assert (
        c.post("/nba/coach/1/card.png", json=_player(), headers=_auth()).status_code
        == 404
    )
