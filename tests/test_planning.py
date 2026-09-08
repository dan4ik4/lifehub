from datetime import timedelta
from uuid import UUID

from sqlalchemy import func, select

from app.core.database import utcnow
from app.modules.planning.models import CalendarEvent, EventException, ListItem, Task, TaskOccurrence
from app.modules.planning.schemas import TaskCreate
from app.modules.planning.service import PlanningService


BASE = "/api/v1/planning"


def event_payload(**changes):
    return {"title": "Daily standup", "start_at": "2026-09-07T09:00:00+02:00", "end_at": "2026-09-07T09:30:00+02:00", "timezone": "Europe/Warsaw", **changes}


def test_module_and_pro_gates(client, make_user, auth_headers):
    locked = auth_headers(make_user(plan="free", free_modules=["health", "finance", "books_diary"]))
    assert client.get(f"{BASE}/tasks", headers=locked).json()["error"]["code"] == "module_locked"
    headers = auth_headers(make_user(plan="free"))
    assert client.post(f"{BASE}/tasks", json={"title": "Normal"}, headers=headers).status_code == 201
    for extra in ({"priority": "high"}, {"rrule": "FREQ=DAILY", "due_at": "2026-09-07T09:00:00Z"}):
        response = client.post(f"{BASE}/tasks", json={"title": "Pro", **extra}, headers=headers)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "pro_required"
    assert client.post(f"{BASE}/lists", json={"name": "Custom"}, headers=headers).status_code == 403
    expired = auth_headers(make_user(plan="trial", trial_ends=utcnow() - timedelta(seconds=1)))
    assert client.post(f"{BASE}/tasks", json={"title": "Pro", "priority": "high"}, headers=expired).status_code == 403


def test_task_owner_scope_versions_completion_and_soft_delete(client, make_user, auth_headers, db):
    user = make_user()
    headers, other = auth_headers(user), auth_headers(make_user())
    created = client.post(f"{BASE}/tasks", json={"title": "Call", "due_at": "2026-09-07T10:00:00Z"}, headers=headers)
    assert created.status_code == 201, created.text
    task = created.json()
    assert task["timezone"] == "Europe/Warsaw"
    url = f"{BASE}/tasks/{task['id']}"
    for method, extra in (("get", {}), ("delete", {}), ("patch", {"json": {"title": "Hijack", "version": 1}})):
        assert getattr(client, method)(url, headers=other, **extra).status_code == 404
    assert client.get(f"{BASE}/tasks", headers=other).json()["total"] == 0
    updated = client.patch(url, json={"title": "Call tomorrow", "version": 1}, headers=headers)
    assert updated.status_code == 200
    assert updated.json()["version"] == 2
    assert client.patch(url, json={"title": "Stale", "version": 1}, headers=headers).status_code == 409
    assert client.post(url + "/complete", json={}, headers=headers).json()["status"] == "completed"
    assert client.post(url + "/complete", json={}, headers=headers).json()["error"]["code"] == "already_completed"
    assert client.post(url + "/reopen", json={}, headers=headers).json()["status"] == "pending"
    assert client.post(url + "/reopen", json={}, headers=headers).status_code == 409
    assert client.delete(url, headers=headers).status_code == 204
    assert client.get(url, headers=headers).status_code == 404
    assert db.get(Task, UUID(task["id"])).deleted_at is not None


def test_recurring_task_occurrence_completion_isolated(client, make_user, auth_headers, db):
    headers = auth_headers(make_user())
    task = client.post(f"{BASE}/tasks", json={"title": "Walk", "start_at": "2026-09-07T09:00:00+02:00", "due_at": "2026-09-07T10:00:00+02:00", "rrule": "FREQ=DAILY;COUNT=3"}, headers=headers).json()
    url = f"{BASE}/tasks/{task['id']}"
    assert client.post(url + "/complete", json={}, headers=headers).status_code == 422
    assert client.post(url + "/complete", json={"occurrence_at": "2026-09-08T07:01:00Z"}, headers=headers).status_code == 422
    done = client.post(url + "/complete", json={"occurrence_at": "2026-09-08T07:00:00Z"}, headers=headers)
    assert done.status_code == 200, done.text
    result = client.get(f"{BASE}/calendar", params={"from": "2026-09-07T00:00:00Z", "to": "2026-09-10T00:00:00Z", "timezone": "Europe/Warsaw"}, headers=headers)
    assert result.status_code == 200, result.text
    assert [x["status"] for x in result.json()["tasks"]] == ["pending", "completed", "pending"]
    assert db.scalar(select(func.count()).select_from(TaskOccurrence)) == 1
    assert db.scalar(select(func.count()).select_from(Task)) == 1
    assert client.post(url + "/reopen", json={"occurrence_at": "2026-09-08T07:00:00Z"}, headers=headers).status_code == 200


def test_event_delete_this_future_and_all_retains_sync_tombstone(client, make_user, auth_headers, db):
    headers = auth_headers(make_user())
    created = client.post(f"{BASE}/events", json=event_payload(rrule="FREQ=DAILY;COUNT=5"), headers=headers)
    assert created.status_code == 201, created.text
    event = created.json()
    url = f"{BASE}/events/{event['id']}"
    params = {"from": "2026-09-07T00:00:00Z", "to": "2026-09-13T00:00:00Z"}
    assert client.delete(url, params={"scope": "this"}, headers=headers).status_code == 422
    assert client.delete(url, params={"scope": "this", "occurrence_at": "2026-09-08T07:00:00Z"}, headers=headers).status_code == 204
    assert len(client.get(f"{BASE}/calendar", params=params, headers=headers).json()["events"]) == 4
    assert db.scalar(select(func.count()).select_from(EventException)) == 1
    assert client.delete(url, params={"scope": "future", "occurrence_at": "2026-09-10T07:00:00Z"}, headers=headers).status_code == 204
    remaining = client.get(f"{BASE}/calendar", params=params, headers=headers).json()["events"]
    assert [x["start_at"] for x in remaining] == ["2026-09-07T07:00:00Z", "2026-09-09T07:00:00Z"]
    assert client.delete(url, params={"scope": "all"}, headers=headers).status_code == 204
    assert db.get(CalendarEvent, UUID(event["id"])).deleted_at is not None
    assert client.get(f"{BASE}/calendar", params=params, headers=headers).json()["events"] == []


def test_delete_future_first_occurrence_deletes_whole_series(client, make_user, auth_headers):
    headers = auth_headers(make_user())
    event = client.post(f"{BASE}/events", json=event_payload(rrule="FREQ=DAILY"), headers=headers).json()
    url = f"{BASE}/events/{event['id']}"
    assert client.delete(url, params={"scope": "future", "occurrence_at": "2026-09-07T07:00:00Z"}, headers=headers).status_code == 204
    assert client.get(url, headers=headers).status_code == 404


def test_event_validation_range_and_readonly_sync(client, make_user, auth_headers, db):
    headers = auth_headers(make_user())
    for change in ({"end_at": "2026-09-07T08:00:00+02:00"}, {"timezone": "Invalid/Nowhere"}, {"start_at": "2026-09-07T09:00:00"}, {"all_day": True}):
        assert client.post(f"{BASE}/events", json=event_payload(**change), headers=headers).status_code == 422
    event = client.post(f"{BASE}/events", json=event_payload(), headers=headers).json()
    row = db.get(CalendarEvent, UUID(event["id"]))
    row.external_read_only = True
    db.commit()
    assert client.patch(f"{BASE}/events/{event['id']}", json={"version": row.version, "title": "Changed"}, headers=headers).json()["error"]["code"] == "sync_conflict"
    assert client.delete(f"{BASE}/events/{event['id']}", headers=headers).status_code == 409
    for params in ({"from": "2026-09-01T00:00:00Z", "to": "2027-01-01T00:00:00Z"}, {"from": "2026-09-02T00:00:00Z", "to": "2026-09-01T00:00:00Z"}):
        assert client.get(f"{BASE}/calendar", params=params, headers=headers).status_code == 422


def test_shopping_list_and_atomic_bulk_items_owner_scope(client, make_user, auth_headers, db):
    headers = auth_headers(make_user(plan="free"))
    lists = client.get(f"{BASE}/lists", headers=headers).json()["items"]
    assert len(lists) == 1 and lists[0]["kind"] == "shopping"
    assert len(client.get(f"{BASE}/lists", headers=headers).json()["items"]) == 1
    url = f"{BASE}/lists/{lists[0]['id']}"
    assert client.delete(url, headers=headers).json()["error"]["code"] == "system_list_locked"
    invalid = client.post(url + "/items/bulk", json={"items": [{"title": "Apple"}, {"title": ""}]}, headers=headers)
    assert invalid.status_code == 422
    assert db.scalar(select(func.count()).select_from(ListItem)) == 0
    created = client.post(url + "/items/bulk", json={"items": [{"title": "Apple", "quantity": "2.5", "unit": "kg"}, {"title": "Tea"}]}, headers=headers)
    assert created.status_code == 201, created.text
    first = created.json()["items"][0]
    assert client.patch(url + f"/items/{first['id']}", json={"version": 1, "checked": True}, headers=headers).status_code == 200
    assert client.patch(url + f"/items/{first['id']}", json={"version": 1, "checked": False}, headers=headers).status_code == 409
    current = client.get(url, headers=headers).json()
    assert current["item_count"] == 2 and current["completed_count"] == 1
    other = auth_headers(make_user())
    assert client.get(url + "/items", headers=other).status_code == 404
    assert client.post(url + "/items/bulk", json={"items": [{"title": "Hijack"}]}, headers=other).status_code == 404


def test_cursor_pages_are_stable_and_owner_bound(client, make_user, auth_headers):
    headers = auth_headers(make_user())
    for index in range(3):
        assert client.post(f"{BASE}/tasks", json={"title": f"Task {index}"}, headers=headers).status_code == 201
    first = client.get(f"{BASE}/tasks", params={"limit": 2}, headers=headers).json()
    second = client.get(f"{BASE}/tasks", params={"limit": 2, "cursor": first["next_cursor"]}, headers=headers).json()
    assert first["total"] == second["total"] == 3
    assert len(first["items"]) == 2 and len(second["items"]) == 1
    assert second["next_cursor"] is None
    assert client.get(f"{BASE}/tasks", params={"cursor": first["next_cursor"]}, headers=auth_headers(make_user())).status_code == 422
    assert client.get(f"{BASE}/tasks", params={"cursor": "%%%"}, headers=headers).status_code == 422


def test_service_commit_false_allows_atomic_ai_rollback(db, make_user):
    user = make_user()
    service = PlanningService(db, user)
    item = service.create_task(TaskCreate(title="Atomic"), commit=False)
    task_id = item.id
    db.rollback()
    assert db.get(Task, task_id) is None
