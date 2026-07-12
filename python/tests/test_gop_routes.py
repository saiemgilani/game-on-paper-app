import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import pytest
from flask import Flask

import gop_routes
from telemetry import Telemetry


class SpyTel(Telemetry):
    def __init__(self):
        super().__init__(enabled=True, conn_factory=lambda: None)
        self.pushed = []

    def push(self, table, row):
        self.pushed.append((table, row))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("GOP_INGEST_KEY", "k")
    tel = SpyTel()
    monkeypatch.setattr(gop_routes, "TEL", tel)
    app = Flask(__name__)
    app.register_blueprint(gop_routes.bp)
    c = app.test_client()
    c.tel = tel
    return c


def test_ingest_requires_key(client):
    r = client.post("/gop/ingest", json={"events": []})
    assert r.status_code == 401
    r = client.post("/gop/ingest", json={"events": []}, headers={"X-GOP-Key": "wrong"})
    assert r.status_code == 401


def test_ingest_accepts_valid_and_skips_unknown_tables(client):
    r = client.post(
        "/gop/ingest",
        headers={"X-GOP-Key": "k"},
        json={
            "events": [
                {
                    "table": "request_log",
                    "row": {"service": "astro", "path": "/cfb/", "status": 200},
                },
                {"table": "drop_tables", "row": {"evil": 1}},
                {
                    "table": "client_event",
                    "row": {"type": "web_vital", "name": "LCP", "value": 2100},
                },
            ]
        },
    )
    assert r.status_code == 202
    assert r.get_json()["accepted"] == 2
    assert [t for t, _ in client.tel.pushed] == ["request_log", "client_event"]


def test_ingest_strips_client_supplied_ts(client):
    client.post(
        "/gop/ingest",
        headers={"X-GOP-Key": "k"},
        json={
            "events": [
                {
                    "table": "request_log",
                    "row": {"service": "astro", "ts": "1999-01-01T00:00:00Z"},
                },
            ]
        },
    )
    _, row = client.tel.pushed[0]
    assert "ts" not in row


def test_admin_requires_key_and_knows_names(client, monkeypatch):
    monkeypatch.setattr(gop_routes, "_q", lambda sql, params=None: [])
    assert client.get("/gop/admin/overview").status_code == 401
    r = client.get("/gop/admin/overview", headers={"X-GOP-Key": "k"})
    assert r.status_code == 200
    assert "reqPerMin" in r.get_json()
    assert client.get("/gop/admin/nope", headers={"X-GOP-Key": "k"}).status_code == 404
