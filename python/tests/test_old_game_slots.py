"""Pre-2010 football games share OLD_GAME_SLOTS workers per host (app.old_games_capped): a crawl of
old games answers busy past that, and the rest of the host stays free for this season's games."""

import base64
import importlib
import os

import pytest

fcntl = pytest.importorskip(
    "fcntl"
)  # the cap is a flock; off where there is none (Windows)


@pytest.fixture
def app_mod(monkeypatch, tmp_path):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    monkeypatch.setenv("GOP_SLOT_DIR", str(tmp_path))
    import app as mod

    importlib.reload(mod)
    monkeypatch.setattr(
        mod,
        "_process_game",
        lambda league, game_id, source=None: ({"ran": game_id}, 200),
    )
    return mod


def _auth():
    return {"Authorization": "Bearer " + base64.b64encode(b"secret").decode()}


def _hold_every_slot(mod):
    """Take each slot the way another worker would: its own descriptor, flock'd."""
    fds = []
    for k in range(mod.OLD_GAME_SLOTS):
        fd = os.open(
            os.path.join(mod._SLOT_DIR, f"gop-old-game-{k}.lock"),
            os.O_CREAT | os.O_RDWR,
        )
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fds.append(fd)
    return fds


@pytest.mark.parametrize("league", ["cfb", "nfl"])
def test_an_old_game_is_busy_while_every_slot_is_held(app_mod, league):
    fds = _hold_every_slot(app_mod)
    try:
        c = app_mod.app.test_client()
        r = c.get(f"/{league}/252810251/process", headers=_auth())
        assert r.status_code == 503 and r.get_json()["status"] == "busy"
        assert r.headers["Retry-After"] == "5"
        # a current game never waits on the old-game slots
        assert c.get(f"/{league}/401520150/process", headers=_auth()).get_json() == {
            "ran": 401520150
        }
    finally:
        for fd in fds:
            os.close(fd)
    # the slots are free again: the old game runs
    assert app_mod.app.test_client().get(
        f"/{league}/252810251/process", headers=_auth()
    ).get_json() == {"ran": 252810251}


def test_one_free_slot_is_enough_and_is_released(app_mod):
    fds = _hold_every_slot(app_mod)
    os.close(fds.pop())  # one worker finished
    try:
        c = app_mod.app.test_client()
        assert c.get("/cfb/282780333/process", headers=_auth()).status_code == 200
        # released after the request: the next old game takes the same slot
        assert c.get("/cfb/292620183/process", headers=_auth()).status_code == 200
    finally:
        for fd in fds:
            os.close(fd)


def test_a_failure_releases_the_slot(app_mod, monkeypatch):
    def boom(league, game_id, source=None):
        raise RuntimeError("pipeline blew up")

    monkeypatch.setattr(app_mod, "_process_game", boom)
    c = app_mod.app.test_client()
    for _ in range(app_mod.OLD_GAME_SLOTS + 1):
        # require_auth_token answers any exception below it with a 401; what matters is it is never busy
        assert c.get("/cfb/252810251/process", headers=_auth()).status_code == 401
    fds = _hold_every_slot(app_mod)  # would raise if a failed request had kept one
    for fd in fds:
        os.close(fd)
