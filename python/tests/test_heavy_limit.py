"""One heavy /process per worker (app.one_heavy_at_a_time): the second answers 503 at once, so
gunicorn's spare thread stays free for /healthcheck (2026-11-16 uptime pages)."""
import base64
import importlib

import pytest


@pytest.fixture
def app_mod(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as mod

    importlib.reload(mod)
    return mod


def _auth():
    return {"Authorization": "Bearer " + base64.b64encode(b"secret").decode()}


@pytest.mark.parametrize("path", ["/cfb/401520150/process", "/nfl/401772944/process", "/nba/401766458/process"])
def test_second_heavy_request_is_busy(app_mod, path):
    assert app_mod._HEAVY.acquire(blocking=False)  # a /process already running in this worker
    try:
        r = app_mod.app.test_client().get(path, headers=_auth())
        assert r.status_code == 503
        assert r.headers["Retry-After"] == "5"
        assert r.get_json()["status"] == "busy"
        # the light routes never wait on it
        assert app_mod.app.test_client().get("/healthcheck").status_code == 200
    finally:
        app_mod._HEAVY.release()


def test_auth_is_checked_before_the_limit(app_mod):
    assert app_mod._HEAVY.acquire(blocking=False)
    try:
        assert app_mod.app.test_client().get("/cfb/401520150/process").status_code == 401
    finally:
        app_mod._HEAVY.release()


def test_the_slot_is_released_after_a_failure(app_mod, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("processor blew up")

    monkeypatch.setattr(app_mod, "_process_game", boom)
    app_mod.app.config["PROPAGATE_EXCEPTIONS"] = False
    app_mod.app.test_client().get("/cfb/401520150/process", headers=_auth())
    assert app_mod._HEAVY.acquire(blocking=False)
    app_mod._HEAVY.release()
