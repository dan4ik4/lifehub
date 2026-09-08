from datetime import datetime, timedelta

from app.core.database import utcnow


BASE = "/api/v1/planning"


def test_completed_one_off_becomes_pending_recurrences(client, make_user, auth_headers):
    headers = auth_headers(make_user())
    created = client.post(f"{BASE}/tasks", json={"title": "Exercise", "start_at": "2026-09-07T07:00:00Z"}, headers=headers)
    assert created.status_code == 201
    url = f"{BASE}/tasks/{created.json()['id']}"
    assert client.post(url + "/complete", json={}, headers=headers).status_code == 200
    recurring = client.patch(url, json={"version": 2, "rrule": "FREQ=DAILY;COUNT=2"}, headers=headers)
    assert recurring.status_code == 200 and recurring.json()["completed"] is False
    calendar = client.get(f"{BASE}/calendar", params={"from": "2026-09-07T00:00:00Z", "to": "2026-09-10T00:00:00Z"}, headers=headers)
    assert [occurrence["status"] for occurrence in calendar.json()["tasks"]] == ["pending", "pending"]


def test_expired_trial_cannot_change_recurring_occurrences_but_can_delete_series(client, make_user, auth_headers, db):
    user = make_user(plan="trial", trial_ends=utcnow() + timedelta(hours=1))
    headers = auth_headers(user)
    task = client.post(f"{BASE}/tasks", json={"title": "Daily task", "start_at": "2026-09-07T07:00:00Z", "rrule": "FREQ=DAILY"}, headers=headers).json()
    event = client.post(f"{BASE}/events", json={"title": "Daily event", "start_at": "2026-09-07T07:00:00Z", "end_at": "2026-09-07T08:00:00Z", "rrule": "FREQ=DAILY"}, headers=headers).json()
    user.trial_ends = utcnow() - timedelta(seconds=1)
    db.commit()
    complete = client.post(f"{BASE}/tasks/{task['id']}/complete", json={"occurrence_at": "2026-09-07T07:00:00Z"}, headers=headers)
    assert complete.status_code == 403 and complete.json()["error"]["code"] == "pro_required"
    for scope in ("this", "future"):
        deletion = client.delete(f"{BASE}/events/{event['id']}", params={"scope": scope, "occurrence_at": "2026-09-07T07:00:00Z"}, headers=headers)
        assert deletion.status_code == 403 and deletion.json()["error"]["code"] == "pro_required"
    assert client.delete(f"{BASE}/events/{event['id']}", headers=headers).status_code == 204


def test_fall_back_event_preserves_explicit_second_fold_end(client, make_user, auth_headers):
    headers = auth_headers(make_user())
    created = client.post(f"{BASE}/events", json={"title": "Fall-back shift", "timezone": "Europe/Warsaw",
        "start_at": "2026-10-25T02:30:00+02:00", "end_at": "2026-10-25T02:45:00+01:00", "rrule": "FREQ=DAILY;COUNT=2"}, headers=headers)
    assert created.status_code == 201, created.text
    result = client.get(f"{BASE}/calendar", params={"from": "2026-10-24T00:00:00Z", "to": "2026-10-27T00:00:00Z"}, headers=headers)
    assert result.status_code == 200
    events = result.json()["events"]
    assert events[0]["start_at"] == "2026-10-25T00:30:00Z"
    assert events[0]["end_at"] == "2026-10-25T01:45:00Z"
    assert events[1]["end_at"] == "2026-10-26T01:45:00Z"


def test_fall_back_series_preserves_explicit_second_fold_start(client, make_user, auth_headers):
    headers = auth_headers(make_user())
    created = client.post(f"{BASE}/events", json={"title": "Second clock hour", "timezone": "Europe/Warsaw",
        "start_at": "2026-10-25T02:30:00+01:00", "end_at": "2026-10-25T03:30:00+01:00", "rrule": "FREQ=DAILY;COUNT=2"}, headers=headers)
    assert created.status_code == 201, created.text
    result = client.get(f"{BASE}/calendar", params={"from": "2026-10-25T00:00:00Z", "to": "2026-10-27T00:00:00Z"}, headers=headers)
    assert result.status_code == 200
    assert [event["start_at"] for event in result.json()["events"]] == ["2026-10-25T01:30:00Z", "2026-10-26T01:30:00Z"]


def test_rescheduled_deadline_rearms_delivered_offset_reminder(db, make_user, settings):
    from app.modules.planning.reminders import MemoryReminderDelivery
    from app.modules.planning.schemas import ReminderCreate, TaskCreate, TaskUpdate
    from app.modules.planning.service import PlanningService
    from app.workers.jobs.reminders import run_reminders
    now = utcnow()
    service = PlanningService(db, make_user())
    task = service.create_task(TaskCreate(title="Rescheduled", due_at=now - timedelta(minutes=1), reminders=[ReminderCreate(offset_minutes=0)]))
    delivery = MemoryReminderDelivery()
    assert run_reminders(db, settings, delivery, now=now)["delivered"] == 1
    service.update_task(task.id, TaskUpdate(version=task.version, due_at=now + timedelta(hours=1)))
    assert run_reminders(db, settings, delivery, now=now + timedelta(minutes=30))["delivered"] == 0
    assert run_reminders(db, settings, delivery, now=now + timedelta(hours=1, seconds=1))["delivered"] == 1
    assert len(delivery.messages) == 2 and delivery.messages[0]["key"] != delivery.messages[1]["key"]
