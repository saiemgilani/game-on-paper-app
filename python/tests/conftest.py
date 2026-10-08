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
