"""The share card (share_card.py) and its route, on the committed real games, offline.

The renderer is driven with the real `/process` payloads (conftest `processed`);
the route with the offline processors of tests/test_usage_box_route.py. Logos come
from a stub returning a 1x1 PNG, so nothing reaches ESPN.
"""

import copy
import gzip
import importlib
import io
import json
import re
import struct
from datetime import datetime, timezone
from pathlib import Path

import pytest
from PIL import Image
from sportsdataverse.cfb import CFBPlayProcess

import share_card
from tests.test_usage_box_route import GAMES, PROCESSORS, _auth

FIX = Path(__file__).parent / "fixtures"
# 01:41 UTC on 3 Oct 2026 is 9:41 PM EDT on the 2nd
NOW = datetime(2026, 10, 3, 1, 41, tzinfo=timezone.utc)
SCORE = re.compile(r"\d+ @ .* \d+")
OT = re.compile(r"\b\d*OT\b")


def _png_1x1():
    buf = io.BytesIO()
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


LOGO = _png_1x1()


def _size(png):
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", png[16:24])  # IHDR width, height


def _render(game, state, variant, league="cfb", logo=lambda url: LOGO):
    drawn = []
    png = share_card.render(game, league, state, variant, logo, NOW, drawn)
    assert _size(png) == (1200, 630)
    return png, drawn


def _live(game, n_plays):
    """The real final game cut to its first `n_plays`, with the status ESPN shows mid-game."""
    g = copy.deepcopy(game)
    g["plays"] = g["plays"][:n_plays]
    last = g["plays"][-1]
    comp = g["header"]["competitions"][0]
    comp["status"]["type"].update(
        completed=False, name="STATUS_IN_PROGRESS", state="in"
    )
    comp["status"]["period"] = last["period"]
    comp["status"]["displayClock"] = last["clock"]["displayValue"]
    for c in comp["competitors"]:
        c["score"] = str(
            last["homeScore"] if c["homeAway"] == "home" else last["awayScore"]
        )
        c["winner"] = None
    return g


def _pregame(projection=None):
    with gzip.open(FIX / "cfb_summary_400869270.json.gz", "rt", encoding="utf-8") as fh:
        summary = json.load(fh)
    return {
        "header": summary["header"],
        "gameInfo": summary.get("gameInfo"),
        "projection": projection,
    }


def test_final_card(processed):
    _, drawn = _render(processed("cfb"), "final", "full")
    assert "Central Michigan 30 @ Oklahoma State 27" in drawn
    assert any(s.startswith("Final") for s in drawn)
    assert any(s.startswith("Deserved Win %: ") for s in drawn)
    assert "gameonpaper.com" in drawn


@pytest.mark.parametrize("league", ["cfb", "nfl"])
def test_live_card_says_when_it_was_drawn(processed, league):
    game = _live(processed(league), 110)
    last = game["plays"][-1]
    _, drawn = _render(game, "live", "full", league)
    assert (
        f"Live / Q{last['period']} {last['clock']['displayValue']} / as of 9:41 PM ET"
        in drawn
    )
    assert not any(s.startswith("Deserved Win") for s in drawn)  # not decided yet


@pytest.mark.parametrize("projection", [None, {"margin": -3.46, "homeWinProb": 0.38}])
def test_pregame_card_from_the_espn_summary(projection):
    _, drawn = _render(_pregame(projection), "pre", "full")
    assert "Central Michigan @ #22 Oklahoma State" in drawn
    assert "Boone Pickens Stadium, Stillwater, OK" in drawn
    assert any(s.endswith("12:00 PM ET / FS1") for s in drawn)
    lines = [s for s in drawn if s.startswith("Projection")]
    assert lines == (["Projection: CMU by 3.5 (62%)"] if projection else [])


@pytest.mark.parametrize("state", ["final", "live"])
def test_spoiler_free_card_draws_no_result(processed, state, monkeypatch):
    # the WP line is the result drawn as a picture: the spoiler-free card never draws it
    def no_chart(*a, **k):
        raise AssertionError("the spoiler-free card drew the WP chart")

    monkeypatch.setattr(share_card._Card, "wp", no_chart)
    for league in ("cfb", "nfl"):
        game = processed(league) if state == "final" else _live(processed(league), 110)
        _, drawn = _render(game, state, "spoilerfree", league)
        for s in drawn:
            assert not SCORE.search(s), s
            assert "Deserved Win" not in s, s
            assert not OT.search(s), s
        assert any("Excitement" in s for s in drawn)
        assert any(s.startswith("Final" if state == "final" else "Live") for s in drawn)
        comp = game["header"]["competitions"][0]
        for c in comp["competitors"]:
            assert any(c["team"]["location"] in s for s in drawn)
        # live: the clock (and so any overtime) stays off the spoiler-free card
        if state == "live":
            assert "Live / as of 9:41 PM ET" in drawn


def test_spoiler_free_hides_overtime(processed):
    game = copy.deepcopy(processed("cfb"))
    game["header"]["competitions"][0]["status"]["type"]["detail"] = "Final/OT"
    live = _live(processed("cfb"), 110)
    live["header"]["competitions"][0]["status"]["period"] = 5
    for g, state in ((game, "final"), (live, "live")):
        _, drawn = _render(g, state, "spoilerfree")
        assert not any(OT.search(s) for s in drawn), drawn
    _, drawn = _render(game, "final", "full")
    assert any(s.startswith("Final/OT") for s in drawn)  # the full card may say it


def test_pregame_has_nothing_to_spoil():
    assert (
        _render(_pregame(), "pre", "spoilerfree")[1]
        == _render(_pregame(), "pre", "full")[1]
    )


def test_without_paper_index(processed):
    game = {k: v for k, v in processed("cfb").items() if k != "paperIndex"}
    _, drawn = _render(game, "final", "full")
    assert not any(s.startswith("Deserved Win") for s in drawn)


def test_missing_logo_prints_the_abbreviation(processed):
    _, drawn = _render(processed("cfb"), "final", "spoilerfree", logo=lambda url: None)
    assert {"CMU", "OKST"} <= set(drawn)


def test_colours_are_the_teams_own(processed):
    game = processed("cfb")
    comp = game["header"]["competitions"][0]
    okst = next(c["team"] for c in comp["competitors"] if c["homeAway"] == "home")
    assert share_card._colour(okst) == "#" + okst["color"]
    # a colour that would vanish on the white card falls back to the alternate, then ink
    assert (
        share_card._colour({"color": "ffffff", "alternateColor": "4c0027"}) == "#4c0027"
    )
    assert (
        share_card._colour({"color": "ffffff", "alternateColor": "f0f0f0"})
        == share_card.INK
    )
    # ... and reaches the image: the team labels are drawn in it
    png, _ = _render(game, "final", "full")
    rgb = tuple(int(okst["color"][i : i + 2], 16) for i in (0, 2, 4))
    assert rgb in {
        px[:3] for px in Image.open(io.BytesIO(png)).convert("RGB").getdata()
    }
    # no palette of our own: the only literal colours are matplotlib's defaults
    assert not re.search(r"#[0-9a-fA-F]{3,6}\b", Path(share_card.__file__).read_text())


def test_unknown_state_or_variant_raises(processed):
    with pytest.raises(ValueError):
        share_card.render(
            processed("cfb"), "cfb", "halftime", "full", lambda u: None, NOW
        )


# --- the route -----------------------------------------------------------------


class _Unknown(CFBPlayProcess):
    """ESPN has no such game: the fetch raises, as sdv-py's download does on a 404."""

    def espn_cfb_pbp(self, summary=None, **kwargs):
        raise RuntimeError("404 from ESPN")


def _as(state):
    """The offline CFB processor with ESPN's status set to `state` (the plays stay real)."""
    status = {
        "pre": {"state": "pre", "completed": False, "name": "STATUS_SCHEDULED"},
        "live": {"state": "in", "completed": False, "name": "STATUS_IN_PROGRESS"},
        "final": {},
    }[state]

    class Processor(PROCESSORS["cfb"][0]):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._summary["header"]["competitions"][0]["status"]["type"].update(status)

    return (Processor, "espn_cfb_pbp")


class _Opener:
    """Stands in for the API's logo opener: records each URL it would have fetched."""

    def __init__(self):
        self.opened = []

    def open(self, url, timeout=None):
        self.opened.append(url)
        return io.BytesIO(LOGO)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    monkeypatch.setitem(app_mod._PROCESSORS, "cfb", PROCESSORS["cfb"])
    # the real allowlist runs; only the network behind it is a stub
    monkeypatch.setattr(app_mod, "_LOGO_OPENER", _Opener())
    return app_mod, app_mod.app.test_client()


@pytest.mark.parametrize("variant", ["full", "spoilerfree"])
@pytest.mark.parametrize("state", ["pre", "live", "final"])
def test_route_every_state_and_variant(client, monkeypatch, state, variant):
    app_mod, c = client
    monkeypatch.setitem(app_mod._PROCESSORS, "cfb", _as(state))
    calls = []
    real = share_card.render

    def spy(game, league, st, va, *a, **k):
        calls.append((st, va, "plays" in game))
        return real(game, league, st, va, *a, **k)

    monkeypatch.setattr(app_mod.share_card, "render", spy)
    r = c.get(
        f"/cfb/{GAMES['cfb']}/card.png?state={state}&variant={variant}", headers=_auth()
    )
    assert r.status_code == 200, r.get_data(as_text=True)[:300]
    assert r.mimetype == "image/png"
    assert _size(r.get_data()) == (1200, 630)
    # the card drawn is the one asked for, and only a played game runs the pipeline
    assert calls == [(state, variant, state != "pre")]


@pytest.mark.parametrize("asked", ["pre", "live"])
def test_route_refuses_a_state_espn_disagrees_with(client, asked):
    # the fixture is final: a card drawn as anything else could be cached as that state
    _, c = client
    r = c.get(f"/cfb/{GAMES['cfb']}/card.png?state={asked}&variant=full", headers=_auth())
    assert r.status_code == 409


def test_route_passes_the_projection(client, monkeypatch):
    app_mod, c = client
    monkeypatch.setitem(app_mod._PROCESSORS, "cfb", _as("pre"))
    seen = {}
    real = share_card.render
    monkeypatch.setattr(
        app_mod.share_card,
        "render",
        lambda game, *a, **k: seen.update(game) or real(game, *a, **k),
    )
    r = c.get(
        f"/cfb/{GAMES['cfb']}/card.png?state=pre&variant=full&proj_margin=-3.5&proj_wp=0.38",
        headers=_auth(),
    )
    assert r.status_code == 200
    assert seen["projection"] == {"margin": -3.5, "homeWinProb": 0.38}
    assert "plays" not in seen  # pregame never runs the pipeline


@pytest.mark.parametrize(
    "query",
    [
        "state=halftime&variant=full",
        "state=final&variant=blur",
        "variant=full",
        "state=pre&proj_margin=three",
    ],
)
def test_route_rejects_bad_parameters(client, query):
    _, c = client
    assert (
        c.get(f"/cfb/{GAMES['cfb']}/card.png?{query}", headers=_auth()).status_code
        == 400
    )


def test_route_unknown_game_is_404(client, monkeypatch):
    app_mod, c = client
    monkeypatch.setitem(app_mod._PROCESSORS, "cfb", (_Unknown, "espn_cfb_pbp"))
    assert (
        c.get("/cfb/1/card.png?state=final&variant=full", headers=_auth()).status_code
        == 404
    )


def test_route_needs_the_token(client):
    _, c = client
    assert (
        c.get(f"/cfb/{GAMES['cfb']}/card.png?state=pre&variant=full").status_code == 401
    )



# --- team art: the Worker picks it, the API fetches only from allowed hosts ---------

UGA = "https://gameonpaper.com/assets/img/ennui-uga.png"
GT = "https://gameonpaper.com/assets/img/gt-old-gold.png"


@pytest.mark.parametrize(
    "url",
    [UGA, "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png", "https://a.espncdn.com/i/teamlogos/nfl/500/30.png"],
)
def test_logo_fetch_allows_the_site_and_espn(client, url):
    app_mod, _ = client
    assert app_mod._logo_fetch(url) == LOGO
    assert app_mod._LOGO_OPENER.opened == [url]


@pytest.mark.parametrize(
    "url",
    [
        "http://a.espncdn.com/i/teamlogos/ncaa/500/197.png",  # not https
        "https://169.254.169.254/latest/meta-data/",  # cloud metadata
        "https://localhost:5000/healthcheck",
        "https://127.0.0.1/x.png",
        "https://gameonpaper.com.evil.example/x.png",  # look-alike host
        "https://evil.example/a.espncdn.com/x.png",
        "https://a.espncdn.com@evil.example/x.png",  # credentials trick: the host is evil.example
        "https://user:pw@gameonpaper.com/x.png",
        "https://gameonpaper.com:8443/x.png",  # another port on an allowed host
        "file:///etc/passwd",
        "not a url",
        None,
    ],
)
def test_logo_fetch_refuses_everything_else(client, url):
    app_mod, _ = client
    assert app_mod._logo_fetch(url) is None
    assert app_mod._LOGO_OPENER.opened == []


def test_logo_fetch_follows_no_redirect():
    # an allowed host that redirects elsewhere must not lead the fetch off the list
    import app as app_mod

    assert any(isinstance(h, app_mod._NoRedirect) for h in app_mod._LOGO_OPENER.handlers)
    assert app_mod._NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://evil.example/") is None


def test_route_draws_the_art_the_worker_chose(client, monkeypatch):
    app_mod, c = client
    seen = {}
    real = share_card.render
    monkeypatch.setattr(app_mod.share_card, "render", lambda game, *a, **k: seen.update(game) or real(game, *a, **k))
    r = c.get(
        f"/cfb/{GAMES['cfb']}/card.png",
        query_string={"state": "final", "variant": "full", "home_logo": UGA, "away_logo": GT},
        headers=_auth(),
    )
    assert r.status_code == 200
    assert seen["logos"] == {"home": UGA, "away": GT}
    assert sorted(app_mod._LOGO_OPENER.opened) == sorted([UGA, GT])


def test_route_without_art_draws_espn_logos(client):
    app_mod, c = client
    assert c.get(f"/cfb/{GAMES['cfb']}/card.png?state=final&variant=full", headers=_auth()).status_code == 200
    assert sorted(app_mod._LOGO_OPENER.opened) == [
        "https://a.espncdn.com/i/teamlogos/ncaa/500/197.png",
        "https://a.espncdn.com/i/teamlogos/ncaa/500/2117.png",
    ]


def test_a_refused_logo_prints_the_abbreviation(client, monkeypatch):
    app_mod, c = client
    drawn = []
    real = share_card.render
    monkeypatch.setattr(app_mod.share_card, "render", lambda game, league, st, va, fetch, now: real(game, league, st, va, fetch, now, drawn))
    r = c.get(
        f"/cfb/{GAMES['cfb']}/card.png",
        query_string={
            "state": "final",
            "variant": "full",
            "home_logo": "http://169.254.169.254/x.png",
            "away_logo": "https://evil.example/x.png",
        },
        headers=_auth(),
    )
    assert r.status_code == 200
    assert app_mod._LOGO_OPENER.opened == []
    assert {"OKST", "CMU"} <= set(drawn)


def test_small_art_is_scaled_to_the_logo_box():
    # UGA's own art is 96x96: drawn at native size it would be half the pregame logo box
    buf = io.BytesIO()
    Image.new("RGBA", (96, 96), (200, 0, 0, 255)).save(buf, format="PNG")
    card = share_card._Card(None)
    card.logo({"id": "61", "abbr": "uga", "colour": share_card.INK, "logo": "x"}, "cfb", lambda url: buf.getvalue(), 330, 315, 200)
    (image,) = card.fig.images
    assert image.get_array().shape[:2] == (200, 200)
