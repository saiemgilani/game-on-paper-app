import base64
import gzip
import importlib
import json
import math
import pathlib

import pytest

FIX = pathlib.Path(__file__).parent / "fixtures" / "nba_summary_401585607.json.gz"


class _Resp:
    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


def _client(monkeypatch, summary, calls=None, pushes=None):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as app_mod

    importlib.reload(app_mod)
    from sportsdataverse.nba import nba_pbp


    def fake_download(url, **kw):
        if calls is not None:
            calls.append(url)
        if isinstance(summary, Exception):
            raise summary
        return _Resp(json.loads(json.dumps(summary)))

    monkeypatch.setattr(nba_pbp, "download", fake_download)
    monkeypatch.setattr(app_mod.TEL, "push", (lambda kind, row: pushes.append((kind, row))) if pushes is not None else (lambda *a, **k: None))
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: None)
    monkeypatch.setattr(app_mod, "_emit_dq", lambda *a, **k: None)
    return app_mod, app_mod.app.test_client()


@pytest.fixture
def client(monkeypatch):
    summary = json.loads(gzip.open(FIX, "rt", encoding="utf-8").read())
    return _client(monkeypatch, summary)[1]


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def test_nba_route_requires_token(client):
    assert client.get("/nba/401585607/process").status_code == 401


def test_nba_route_payload_shape(client):
    r = client.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 200
    body = r.get_json()
    assert body["gameId"] == 401585607 and body["source"] == "processor"
    assert body["prior"]["source"] == "hfa" and 0.5 < body["prior"]["home_win_prob"] < 0.6
    assert body["periods"] == 4 and body["status"]["completed"] is True
    assert body["teamInfo"]["home"]["id"] == "19" and body["teamInfo"]["away"]["id"] == "28"
    assert len(body["plays"]) == 450
    p = body["plays"][200]
    for k in ("id", "game_play_number", "period_number", "clock_display_value", "home_score", "away_score",
              "team_id", "text", "home_win_prob", "wp_delta", "wp_regime", "x_legacy", "y_legacy"):
        assert k in p, k
    assert all(not (isinstance(q["home_win_prob"], float) and math.isnan(q["home_win_prob"])) for q in body["plays"])
    assert set(body["teams"]) == {"home", "away"}
    home = body["teams"]["home"]
    assert home["team_id"] == 19 and "efg_pct" in home["rates"] and "field_goals_attempted" in home["box"]
    assert len(home["linescores"]) == 4
    players = body["players"]["home"] + body["players"]["away"]
    assert players and all("ts_pct" in q and "usg_pct" in q and "athlete_id" in q for q in players)
    dnp = [q for q in players if q["did_not_play"]]
    assert all(q["ts_pct"] is None and q["usg_pct"] is None for q in dnp)
    located = [q for q in body["plays"] if q["x_legacy"] is not None]
    assert len(located) > 100 and all(q["shooting_play"] for q in located)


def test_nba_final_play_resolves_win_probability(client):
    body = client.get("/nba/401585607/process", headers=auth()).get_json()
    assert body["plays"][-1]["home_win_prob"] in (0.0, 1.0)


def _summary():
    return json.loads(gzip.open(FIX, "rt", encoding="utf-8").read())


def test_football_routes_kept_and_nba_is_separate(monkeypatch):
    app_mod, _ = _client(monkeypatch, _summary())
    rules = {r.rule: r.endpoint for r in app_mod.app.url_map.iter_rules()}
    assert "/cfb/<int:game_id>/process" in rules and "/nfl/<int:game_id>/process" in rules
    nba = next(e for rule, e in rules.items() if rule.startswith("/nba/") and rule.endswith("/process"))
    assert nba not in (rules["/cfb/<int:game_id>/process"], rules["/nfl/<int:game_id>/process"])
    assert "nba" not in app_mod._PROCESSORS


def test_nba_malformed_espn_payload_is_404(monkeypatch):
    _, c = _client(monkeypatch, {})
    r = c.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 404
    assert r.get_json()["status"] == "bad"


@pytest.mark.parametrize("bad", ["1", "99999", "99999999999999999999", "1000000000000"])
def test_nba_bad_ids_404_without_calling_espn(monkeypatch, bad):
    calls = []
    _, c = _client(monkeypatch, _summary(), calls=calls)
    assert c.get(f"/nba/{bad}/process", headers=auth()).status_code == 404
    assert calls == []


def test_nba_espn_404_is_clean_404(monkeypatch):
    from sportsdataverse.errors import NoDataError

    pushes = []
    app_mod, c = _client(monkeypatch, NoDataError("404 for summary"), pushes=pushes)
    logged = []
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: logged.append(a))
    r = c.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 404 and r.get_json()["status"] == "bad"
    assert logged == []  # not a bug in this service: no error-log row
    row = [r for k, r in pushes if k == "upstream_log"][-1]
    assert row["ok"] is True and row["status"] == 404  # the fetch succeeded; nothing there


def test_nba_espn_outage_is_502_without_error_row(monkeypatch):
    from sportsdataverse.errors import AssetFetchError

    pushes = []
    app_mod, c = _client(monkeypatch, AssetFetchError("403 after retries"), pushes=pushes)
    logged = []
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: logged.append(a))
    r = c.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 502 and logged == []
    row = [r for k, r in pushes if k == "upstream_log"][-1]
    assert row["target"] == "espn_nba_pbp" and row["ok"] is False


def test_nba_success_pushes_upstream_row_and_cache_header(monkeypatch):
    pushes = []
    _, c = _client(monkeypatch, _summary(), pushes=pushes)
    r = c.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 200 and r.headers["X-Result-Cache"] == "MISS"
    rows = [row for kind, row in pushes if kind == "upstream_log"]
    assert len(rows) == 1
    assert rows[0]["target"] == "espn_nba_pbp" and rows[0]["ok"] is True and rows[0]["status"] == 200
    assert rows[0]["duration_ms"] is not None and rows[0]["game_id"] == "401585607"


def test_nba_pre_tip_game_without_plays_is_404(monkeypatch):
    summary = _summary()
    del summary["plays"]
    _, c = _client(monkeypatch, summary)
    r = c.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 404 and r.get_json()["status"] == "bad"
    summary["plays"] = []
    _, c = _client(monkeypatch, summary)
    assert c.get("/nba/401585607/process", headers=auth()).status_code == 404


def test_nba_dash_linescore_maps_to_null(monkeypatch):
    summary = _summary()
    comp = summary["header"]["competitions"][0]["competitors"][0]
    comp["linescores"][-1]["displayValue"] = "-"
    _, c = _client(monkeypatch, summary)
    r = c.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 200
    body = r.get_json()
    assert None in body["teams"][comp["homeAway"]]["linescores"]


def test_nba_payload_carries_venue(client):
    assert client.get("/nba/401585607/process", headers=auth()).get_json()["venue"] == "Kia Center"


def test_nba_parse_error_on_a_game_with_plays_is_500_with_error_row(monkeypatch):
    import polars as pl
    from sportsdataverse.nba import nba_pbp

    app_mod, c = _client(monkeypatch, _summary())
    logged = []
    monkeypatch.setattr(app_mod.TEL, "log_error", lambda *a, **k: logged.append(a))

    def boom(*a, **k):
        raise pl.exceptions.ColumnNotFoundError("x")

    monkeypatch.setattr(nba_pbp, "helper_nba_pbp", boom)
    r = c.get("/nba/401585607/process", headers=auth())
    assert r.status_code == 500 and len(logged) == 1
