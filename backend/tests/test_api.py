from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_bodies_include_moon():
    r = client.get("/api/bodies")
    assert r.status_code == 200
    assert any(b["id"] == "moon" for b in r.json())


def test_lunar_sites():
    assert client.get("/api/sites/lunar").status_code == 200


def test_mission_rejects_unknown_mode():
    body = {"launch_time_ms": 0, "launch_lat": 28.6, "launch_lon": -80.6,
            "landing_lat": 0.67, "landing_lon": 23.47, "mode": "turbo"}
    assert client.post("/api/mission", json=body).status_code == 422


def test_mission_unknown_id():
    assert client.get("/api/mission/nope").status_code == 404
