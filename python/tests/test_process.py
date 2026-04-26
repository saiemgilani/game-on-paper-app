from unittest.mock import patch

import pytest


def test_process_missing_game_id_returns_404(client):
    response = client.post("/cfb/process", json={})
    assert response.status_code == 404
    body = response.get_json()
    assert body["status"] == "bad"


def test_process_unknown_error_returns_500(client):
    with patch("app.CFBPlayProcess", side_effect=RuntimeError("boom")):
        response = client.post("/cfb/process", json={"gameId": 401403910})
    assert response.status_code == 500
    body = response.get_json()
    assert body["status"] == "bad"
    assert "Unknown error" in body["message"]


@pytest.mark.integration
def test_process_real_game_id_returns_payload(client):
    response = client.post("/cfb/process", json={"gameId": 401403910})
    assert response.status_code == 200
    body = response.get_json()
    assert body["id"] == 401403910
    assert body["count"] > 0
    assert isinstance(body["plays"], list)
    assert "homeTeamId" in body and "awayTeamId" in body
