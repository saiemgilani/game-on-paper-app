import base64

import pytest
from flask import Flask

import espn_proxy


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    app = Flask(__name__)
    app.register_blueprint(espn_proxy.bp)
    return app.test_client()


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def test_allowlist():
    assert espn_proxy.espn_url_allowed(
        "https://cdn.espn.com/core/college-football/scoreboard?xhr=1"
    )
    assert espn_proxy.espn_url_allowed("https://site.web.api.espn.com/apis/site/v2/x")
    assert not espn_proxy.espn_url_allowed("http://cdn.espn.com/x")  # not https
    assert not espn_proxy.espn_url_allowed(
        "https://evil.com/cdn.espn.com"
    )  # host, not path
    assert not espn_proxy.espn_url_allowed("https://cdn.espn.com.evil.com/x")
    assert not espn_proxy.espn_url_allowed("")


def test_requires_token(client):
    assert client.get("/espn/proxy?url=https://cdn.espn.com/x").status_code == 401
    assert (
        client.get(
            "/espn/proxy?url=https://cdn.espn.com/x", headers=auth("wrong")
        ).status_code
        == 401
    )


def test_rejects_non_espn(client):
    assert (
        client.get("/espn/proxy?url=https://example.com/", headers=auth()).status_code
        == 400
    )


def test_relays_body_status_and_content_type(client, monkeypatch):
    class R:
        status_code = 403
        content = b"<HTML>Access Denied"
        headers = {"Content-Type": "text/html"}

    seen = {}

    def fake_get(url, headers, timeout):
        seen["url"], seen["ua"] = url, headers["User-Agent"]
        return R()

    monkeypatch.setattr(espn_proxy.requests, "get", fake_get)
    r = client.get(
        "/espn/proxy?url=https%3A%2F%2Fcdn.espn.com%2Fcore%2Fscoreboard%3Fxhr%3D1",
        headers=auth(),
    )
    assert r.status_code == 403 and r.data == b"<HTML>Access Denied"
    assert (
        r.headers["X-Espn-Proxy"] == "1"
        and seen["url"] == "https://cdn.espn.com/core/scoreboard?xhr=1"
    )
    assert seen["ua"].startswith("Mozilla/5.0 (Macintosh")
