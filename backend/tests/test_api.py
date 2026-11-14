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
