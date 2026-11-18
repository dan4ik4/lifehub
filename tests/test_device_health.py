from datetime import timedelta
from zoneinfo import ZoneInfo
from app.core.database import utcnow

BASE = "/api/v1/health/device"


def setup_device(client, make_user, auth_headers):
    user = make_user()
    headers = auth_headers(user)
    connection = client.post(BASE + "/connect", headers=headers, json={"provider": "health_connect", "consent": True})
    assert connection.status_code == 200, connection.text
    day = utcnow().astimezone(ZoneInfo(user.timezone)).date().isoformat()
    body = {"provider": "health_connect", "sync_token": connection.json()["sync_token"], "revision": connection.json()["revision"], "timezone": user.timezone, "metrics": ["steps", "sleep"], "days": [{"day": day, "steps": 5000, "sleep_seconds": 28800}]}
    return user, headers, body


def test_snapshot_revision_and_partial_updates(client, make_user, auth_headers):
    _, h, body = setup_device(client, make_user, auth_headers)
    first = client.post(BASE + "/sync", headers=h, json=body)
    assert first.status_code == 200, first.text
    assert client.post(BASE + "/sync", headers=h, json=body).status_code == 409
    body.update(revision=first.json()["revision"], metrics=["steps"])
    body["days"][0]["steps"] = 6000
    assert client.post(BASE + "/sync", headers=h, json=body).status_code == 200
    result = client.get(BASE, headers=h).json()
    assert "sync_token" not in result["connection"]
    assert result["days"][0]["steps"] == 6000
    assert result["days"][0]["sleep_seconds"] == 28800
    dashboard = client.get("/api/v1/dashboard", headers=h).json()["widgets"]
    assert dashboard["sleep_week"][-1]["hours"] == 8
    assert dashboard["device_health"][0]["steps"] == 6000


def test_ownership_disconnect_and_erase(client, make_user, auth_headers):
    _, h, body = setup_device(client, make_user, auth_headers)
    other = auth_headers(make_user())
    assert client.get(BASE).status_code == 401
    assert client.post(BASE + "/sync", headers=other, json=body).status_code == 409
    assert client.get(BASE, headers=other).json()["days"] == []
    assert client.post(BASE + "/sync", headers=h, json=body).status_code == 200
    assert client.delete(BASE, headers=h).status_code == 200
    assert client.post(BASE + "/sync", headers=h, json=body).status_code == 409
    assert len(client.get(BASE, headers=h).json()["days"]) == 1
    assert client.delete(BASE + "?erase=true", headers=h).status_code == 200
    assert client.get(BASE, headers=h).json()["days"] == []


def test_validation_and_reconnect_invalidates_old_upload(client, make_user, auth_headers):
    _, h, body = setup_device(client, make_user, auth_headers)
    assert client.post(BASE + "/connect", headers=h, json={"provider": "health_connect", "consent": False}).status_code == 422
    assert client.post(BASE + "/sync", headers=h, json={**body, "timezone": "UTC"}).status_code == 409
    invalid = {**body, "days": [body["days"][0], body["days"][0]]}
    assert client.post(BASE + "/sync", headers=h, json=invalid).status_code == 422
    assert client.post(BASE + "/sync", headers=h, json={**body, "days": [{"day": "2099-01-01", "steps": 20}]}).status_code == 422
    assert client.post(BASE + "/connect", headers=h, json={"provider": "apple_health", "consent": True}).status_code == 200
    assert client.post(BASE + "/sync", headers=h, json=body).status_code == 409


def test_module_gate(client, make_user, auth_headers):
    h = auth_headers(make_user(plan="free", free_modules=["planning", "books", "finance"]))
    assert client.get(BASE, headers=h).status_code == 403


def test_export_includes_values_without_sync_credential(client, db, make_user, auth_headers):
    from app.modules.users.privacy import collect_data
    user, h, body = setup_device(client, make_user, auth_headers)
    assert client.post(BASE + "/sync", headers=h, json=body).status_code == 200
    exported = collect_data(db, user)
    assert exported["health_device_days"][0]["steps"] == 5000
    assert "sync_token" not in exported["health_connections"][0]


def test_manual_sleep_precedes_import_and_revoke_after_plan_change(client, db, make_user, auth_headers):
    from datetime import datetime
    from app.modules.health.models import SleepEntry
    user, h, body = setup_device(client, make_user, auth_headers)
    assert client.post(BASE + "/sync", headers=h, json=body).status_code == 200
    end = datetime.fromisoformat(body["days"][0]["day"] + "T08:00:00").replace(tzinfo=ZoneInfo(user.timezone))
    db.add(SleepEntry(user_id=user.id, start_at=end-timedelta(hours=6), end_at=end, quality=3))
    db.commit()
    dashboard = client.get("/api/v1/dashboard", headers=h).json()["widgets"]
    assert dashboard["sleep_week"][-1]["hours"] == 6
    user.plan = "free"
    user.free_modules = ["planning", "books", "finance"]
    db.commit()
    assert client.delete(BASE + "?erase=true", headers=h).status_code == 200
