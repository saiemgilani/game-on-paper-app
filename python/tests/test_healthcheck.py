def test_healthcheck_returns_ok(client):
    response = client.get("/healthcheck")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}
