import importlib
import os

import pytest


@pytest.fixture(scope="session")
def processed():
    """`processed(league)`: the real `/process` payload of the committed final game.

    One pipeline run per league for the whole session (a run takes seconds), driven
    offline through the route exactly as tests/test_usage_box_route.py does it, and
    undone by hand the same way."""
    from tests.test_usage_box_route import GAMES, PROCESSORS, _auth

    cache = {}

    def get(league):
        if league in cache:
            return cache[league]
        prior = os.environ.get("PYTHON_HTTP_TOKEN")
        os.environ["PYTHON_HTTP_TOKEN"] = "secret"
        import app as app_mod

        importlib.reload(app_mod)
        saved = (app_mod._PROCESSORS[league], app_mod.TEL.push, app_mod._emit_dq)
        app_mod._PROCESSORS[league] = PROCESSORS[league]
        app_mod.TEL.push = lambda *a, **k: None
        app_mod._emit_dq = lambda *a, **k: None
        try:
            r = app_mod.app.test_client().get(
                f"/{league}/{GAMES[league]}/process", headers=_auth()
            )
            assert r.status_code == 200, r.get_data(as_text=True)[:300]
            cache[league] = r.get_json()
        finally:
            app_mod._PROCESSORS[league], app_mod.TEL.push, app_mod._emit_dq = saved
            if prior is None:
                os.environ.pop("PYTHON_HTTP_TOKEN", None)
            else:
                os.environ["PYTHON_HTTP_TOKEN"] = prior
        return cache[league]

    return get



@pytest.fixture(autouse=True)
def _no_data_api(monkeypatch):
    """The basketball route reads the league's shot cells from the Data API (shot_cells.py): never in tests.
    No key is set (so no read is tried), and a read that gets as far as the HTTP call fails the test at
    teardown (league_shot_cells swallows the error by design). A test that wants cells seeds shot_cells._cache."""
    import shot_cells

    reached = []
    monkeypatch.delenv("SDV_AUTH_TOKEN", raising=False)
    monkeypatch.setattr(shot_cells, "_get", lambda url, token: reached.append(url) or {})
    monkeypatch.setattr(shot_cells, "_cache", {})
    yield
    assert reached == [], f"a test reached the Data API: {reached}"
