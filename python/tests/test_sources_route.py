"""`GET /{league}/{id}/sources` -- what the admin source toggle lists.

The route exists so Game on Paper never keeps its own list of sources: the
answer IS the contract's registry, so a pin carrying a new adapter starts
offering it with no change here or in the Astro tree. It also must not probe
availability -- one upstream fetch per source per page render.
"""

import base64
import importlib

import pytest


@pytest.fixture
def app_mod(monkeypatch):
    monkeypatch.setenv("PYTHON_HTTP_TOKEN", "secret")
    import app as mod

    importlib.reload(mod)
    return mod


@pytest.fixture
def client(app_mod):
    return app_mod.app.test_client()


def auth(tok="secret"):
    return {"Authorization": "Bearer " + base64.b64encode(tok.encode()).decode()}


def test_the_route_is_authenticated_like_process(client):
    assert client.get("/cfb/400869270/sources").status_code == 401
    assert client.get("/cfb/400869270/sources", headers=auth("wrong")).status_code == 401


@pytest.mark.parametrize("league,path", [("cfb", "/cfb/400869270/sources"), ("nfl", "/nfl/401772944/sources")])
def test_it_answers_the_contract_registry_in_failover_order(client, app_mod, monkeypatch, league, path):
    monkeypatch.setattr(app_mod, "_SOURCE_ORDER", {"cfb": ("espn", "ncaa"), "nfl": ("espn", "shield")})
    body = client.get(path, headers=auth()).get_json()
    assert body["league"] == league
    assert body["sources"][0] == "espn"          # ESPN is the default and the terminal fallback
    assert body["sources"] == list(app_mod._SOURCE_ORDER[league])
    assert body["contract_version"] == app_mod._SDV_VERSION
    assert body["contract_sha"] == app_mod._SDV_SHA


def test_a_pin_without_the_contract_offers_espn_alone(client, app_mod, monkeypatch):
    # the state before the source contract landed: `?source=` accepts espn and
    # 400s everything else, and the toggle must show exactly that
    monkeypatch.setattr(app_mod, "_SOURCE_ORDER", {})
    assert client.get("/nfl/1/sources", headers=auth()).get_json()["sources"] == ["espn"]


def test_it_never_fetches_a_source_to_test_availability(client, app_mod, monkeypatch):
    def boom(*a, **k):  # pragma: no cover - the assertion is that it never runs
        raise AssertionError("listing sources must not process or fetch anything")

    monkeypatch.setattr(app_mod, "_dispatch_game", boom)
    monkeypatch.setitem(app_mod._PROCESSORS, "nfl", (boom, "espn_nfl_pbp"))
    assert client.get("/nfl/401772944/sources", headers=auth()).status_code == 200


def test_every_listed_source_is_one_process_accepts(client, app_mod):
    # the two routes read the same registry, so a source the toggle offers can
    # never be one `?source=` rejects with a 400
    for league, path in (("cfb", "/cfb/400869270"), ("nfl", "/nfl/401772944")):
        listed = client.get(f"{path}/sources", headers=auth()).get_json()["sources"]
        assert listed == list(app_mod._SOURCE_ORDER.get(league) or ("espn",))
        assert client.get(f"{path}/process?source=nope", headers=auth()).status_code == 400
