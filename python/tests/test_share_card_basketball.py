"""'bball-share-card': the basketball card (share_card.render_basketball) and its route, offline.

The body is what astro basketball/shareCard.ts builds from the page's game, here from the real processor payload of
TOR 96 at ORL 111 (2024-03-17, final). Logos come from a stub, so nothing reaches ESPN.
"""

import copy
import importlib
import re
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from PIL import Image

import share_card
from tests.test_usage_box_route import _auth

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2024, 3, 18, 0, 41, tzinfo=timezone.utc)  # 8:41 PM EDT on the 17th
GAME_ID = 401585607


def _logo(url):
    buf = io.BytesIO()
    Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _body(gei=3.54):
    """The Worker's body for the real final (astro basketballCardBody)."""
    p = json.loads(
        (FIX / "nba_process_401585607.payload.json").read_text(encoding="utf-8")
    )
    comp = p["header"]["competitions"][0]

    def side(ha):
        c = next(x for x in comp["competitors"] if x["homeAway"] == ha)
        t = c["team"]
        return {
            "id": t["id"],
            "abbr": t["abbreviation"],
            "name": t["location"],
            "score": int(c["score"]),
            "winner": c.get("winner"),
            "color": t.get("color"),
            "alternateColor": t.get("alternateColor"),
            "logo": f"https://a.espncdn.com/i/teamlogos/nba/500/{t['abbreviation'].lower()}.png",
        }

    return {
        "home": side("home"),
        "away": side("away"),
        "detail": p["status"]["detail"],
        "date": comp["date"],
        "regulation": 4,
        "plays": [
            [r["period_number"], r["home_win_prob"], r["start_game_seconds_remaining"]]
            for r in p["plays"]
            if r["home_win_prob"] is not None
        ],
        "gei": gei,
    }


def _live(body, n):
    b = copy.deepcopy(body)
    b["plays"] = b["plays"][:n]
    b["detail"], b["gei"] = "5:32 - 3rd Quarter", None
    return b


def _render(body, state):
    drawn = []
    png = share_card.render_basketball(body, "nba", state, _logo, NOW, drawn)
    assert Image.open(io.BytesIO(png)).size == (1200, 630)
    return png, drawn


def test_final_card_has_the_score_the_line_and_the_gei():
    _, drawn = _render(_body(), "final")
    assert "Toronto 96 @ Orlando 111" in drawn
    assert "Final / Mar 17, 2024" in drawn
    assert "Game Excitement Index: 3.54" in drawn
    assert {"Q2", "Q3", "Q4", "ORL", "TOR", "gameonpaper.com"} <= set(drawn)


def test_final_line_ends_at_the_result(monkeypatch):
    body = _body()
    seen = {}
    real = share_card._Card.line

    def spy(self, pts, *a, **k):
        seen["pts"] = pts
        return real(self, pts, *a, **k)

    monkeypatch.setattr(share_card._Card, "line", spy)
    _render(body, "final")
    assert len(seen["pts"]) == len(body["plays"]) + 1
    assert seen["pts"][-1] == (4, 1.0)  # ORL, the home side, won


def test_no_gei_without_one():
    _, drawn = _render(_body(gei=None), "final")
    assert not any(s.startswith("Game Excitement") for s in drawn)


def test_live_card_never_draws_a_gei():
    # even if a body carried one: the GEI is a final's
    body = _live(_body(), 250)
    body["gei"] = 2.0
    _, drawn = _render(body, "live")
    assert "Live / 5:32 - 3rd Quarter / as of 8:41 PM ET" in drawn
    assert not any(s.startswith("Game Excitement") for s in drawn)


def test_live_axis_spans_regulation():
    body = _live(_body(), 250)
    left = [p[2] for p in body["plays"]]
    assert share_card._bball_elapsed(body["plays"], 4) == pytest.approx(
        (2880 - left[-1]) / 2880
    )
    body["plays"][-1][0] = 5  # overtime
    assert share_card._bball_elapsed(body["plays"], 4) == 1.0


def test_halves_are_labelled_h2():
    label = share_card._period_label(2)
    assert [label(p) for p in (2, 3, 4)] == ["H2", "OT", "OT"]
    assert share_card._period_label(4)(4) == "Q4"


def test_unknown_state_raises():
    with pytest.raises(ValueError):
        share_card.render_basketball(_body(), "nba", "pre", _logo, NOW)


# --- the route -----------------------------------------------------------------


class _Opener:
    def __init__(self):
        self.opened = []

    def open(self, url, timeout=None):
        self.opened.append(url)
        return io.BytesIO(_logo(url))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    monkeypatch.setattr(app_mod, "_LOGO_OPENER", _Opener())
    return app_mod, app_mod.app.test_client()


@pytest.mark.parametrize("league", ["nba", "wnba", "mbb", "wbb"])
def test_route_draws_the_body_it_is_sent(client, league):
    app_mod, c = client
    r = c.post(
        f"/{league}/{GAME_ID}/card.png?state=final", json=_body(), headers=_auth()
    )
    assert r.status_code == 200, r.get_data(as_text=True)[:300]
    assert r.mimetype == "image/png"
    assert Image.open(io.BytesIO(r.get_data())).size == (1200, 630)
    # the art the Worker chose, through the API's allowlist
    assert app_mod._LOGO_OPENER.opened == [
        _body()["away"]["logo"],
        _body()["home"]["logo"],
    ]


@pytest.mark.parametrize("query", ["", "?state=pre", "?state=halftime"])
def test_route_rejects_a_bad_state(client, query):
    _, c = client
    assert (
        c.post(
            f"/nba/{GAME_ID}/card.png{query}", json=_body(), headers=_auth()
        ).status_code
        == 400
    )


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        {"home": {}},
        {"home": {}, "away": {}, "plays": [[1, 0.5]]},
        {"home": {}, "away": {}, "plays": {}},
    ],
)
def test_route_rejects_a_malformed_body(client, body):
    _, c = client
    assert (
        c.post(
            f"/nba/{GAME_ID}/card.png?state=final", json=body, headers=_auth()
        ).status_code
        == 400
    )


def test_route_render_failure_is_a_500(client):
    _, c = client
    body = _body()
    body["plays"][0][1] = "not a number"
    assert (
        c.post(
            f"/nba/{GAME_ID}/card.png?state=final", json=body, headers=_auth()
        ).status_code
        == 500
    )


def test_route_needs_the_token(client):
    _, c = client
    assert (
        c.post(f"/nba/{GAME_ID}/card.png?state=final", json=_body()).status_code == 401
    )
    assert (
        c.get(f"/nba/{GAME_ID}/card.png?state=final", headers=_auth()).status_code
        == 405
    )


def test_spoilerfree_card_hides_the_score_the_detail_and_the_line(monkeypatch):
    """?spoilers=off: the matchup, Final and the date, the GEI; never the score, "Final/OT" or the WP line."""
    drawn_line = []
    monkeypatch.setattr(share_card._Card, "line", lambda self, *a, **k: drawn_line.append(a))
    body = _body()
    body["detail"] = "Final/OT"
    drawn = []
    png = share_card.render_basketball(body, "nba", "final", _logo, NOW, drawn, variant="spoilerfree")
    assert Image.open(io.BytesIO(png)).size == (1200, 630)
    assert "Toronto @ Orlando" in drawn
    assert "Final / Mar 17, 2024" in drawn
    assert "3.54" in drawn and "Score hidden" in drawn
    assert not any("96" in s or "111" in s or "OT" in s for s in drawn)
    assert drawn_line == []
    live = []
    share_card.render_basketball(_live(_body(), 250), "nba", "live", _logo, NOW, live, variant="spoilerfree")
    assert "Live / as of 8:41 PM ET" in live and not any("3rd Quarter" in s for s in live)


def test_unknown_variant_raises():
    with pytest.raises(ValueError):
        share_card.render_basketball(_body(), "nba", "final", _logo, NOW, variant="blurred")


def test_route_passes_the_variant(client):
    _, c = client
    ok = c.post(f"/nba/{GAME_ID}/card.png?state=final&variant=spoilerfree", json=_body(), headers=_auth())
    assert ok.status_code == 200 and ok.mimetype == "image/png"
    assert c.post(f"/nba/{GAME_ID}/card.png?state=final&variant=x", json=_body(), headers=_auth()).status_code == 400


def _series_body():
    """The Worker's series body (astro basketball/seriesCard.ts) for the real 2025 NBA Finals: OKC over IND in seven."""
    side = lambda i, abbr, name: {"id": i, "abbr": abbr, "name": name, "color": "007ac1", "alternateColor": "ef3b24", "logo": f"https://a.espncdn.com/i/teamlogos/nba/500/{abbr.lower()}.png"}  # noqa: E731
    scores = [(110, 111, "b"), (123, 107, "a"), (107, 116, "b"), (111, 104, "a"), (120, 109, "a"), (91, 108, "b"), (103, 91, "a")]
    return {
        "stamp": "2024-25 NBA Finals",
        "a": side(25, "OKC", "Oklahoma City"),
        "b": side(11, "IND", "Indiana"),
        "status": "OKC wins 4-3",
        "games": [{"label": f"G{i + 1}", "a": x, "b": y, "winner": w} for i, (x, y, w) in enumerate(scores)],
    }


def test_series_card_draws_the_status_and_every_game():
    drawn = []
    png = share_card.render_basketball_series(_series_body(), "nba", "full", _logo, drawn)
    assert Image.open(io.BytesIO(png)).size == (1200, 630)
    assert {"2024-25 NBA Finals", "Oklahoma City vs. Indiana", "OKC wins 4-3", "G1", "G7", "103-91", "110-111"} <= set(drawn)


def test_spoilerfree_series_card_has_the_matchup_and_round_only():
    drawn = []
    share_card.render_basketball_series(_series_body(), "nba", "spoilerfree", _logo, drawn)
    assert "Oklahoma City vs. Indiana" in drawn and "2024-25 NBA Finals" in drawn and "Series score hidden" in drawn
    # no series score, no game label, no game score
    assert not any("wins" in x or "leads" in x or re.fullmatch(r"G\d|\d+-\d+", x) for x in drawn)


def test_series_route(client):
    app_mod, c = client
    r = c.post("/nba/series/2025-11-25/card.png?variant=full", json=_series_body(), headers=_auth())
    assert r.status_code == 200 and r.mimetype == "image/png"
    assert c.post("/wnba/series/2025-11-17/card.png?variant=spoilerfree", json=_series_body(), headers=_auth()).status_code == 200
    assert c.post("/nba/series/2025-11-25/card.png?variant=x", json=_series_body(), headers=_auth()).status_code == 400
    assert c.post("/nba/series/x/card.png", json=_series_body(), headers=_auth()).status_code == 404
    assert c.post("/nba/series/2025-11-25/card.png", json={"a": {}}, headers=_auth()).status_code == 400
    assert c.post("/mbb/series/2025-11-25/card.png", json=_series_body(), headers=_auth()).status_code == 404
