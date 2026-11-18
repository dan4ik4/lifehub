from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import select
from app.core.database import utcnow
from app.modules.planning.commands import ActionEnvelope
from app.modules.planning.command_models import PlanningCommandRecord
from app.modules.planning.chat_context import normalize_weekly_start
from tests.test_commands import configure


def chat(client, headers, text="Что у меня сегодня?", key="chat-1", **extra):
    return client.post(
        "/api/v1/ai/chat",
        headers={**headers, "Idempotency-Key": key},
        json={"message": text, "mode": "chat", "planning_context_allowed": True, **extra},
    )


def event(client, headers, **extra):
    start = utcnow().replace(hour=12, minute=0, second=0, microsecond=0)
    response = client.post(
        "/api/v1/planning/events",
        headers=headers,
        json={
            "title": "Пара",
            "start_at": start.isoformat(),
            "end_at": (start + timedelta(hours=2)).isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_chat_persists_followup_and_scopes_calendar(client, app, make_user, auth_headers):
    a, b = auth_headers(make_user()), auth_headers(make_user())
    mine, other = event(client, a), event(client, b, title="Secret")
    model = configure(app, {"type": "clarify", "message": "В какое время?"})
    first = chat(client, a)
    assert first.status_code == 200, first.text
    assert model.context["events"][0]["id"] == mine["id"]
    assert all(x["id"] != other["id"] for x in model.context["events"])
    model.action = {"type": "reply", "message": "Давайте в 15:00."}
    second = chat(client, a, "В три", "chat-2")
    assert second.status_code == 200, second.text
    assert model.context["history"][0]["user"] == "Что у меня сегодня?"
    assert model.context["history"][0]["assistant"] == "В какое время?"
    history = client.get("/api/v1/ai/chat/history", headers=a).json()
    assert len(history["items"]) == 2
    assert client.get("/api/v1/ai/chat/history", headers=b).json()["items"] == []
    assert chat(client, a, "В три", "chat-2").json() == second.json()
    assert len(client.get("/api/v1/ai/chat/history", headers=a).json()["items"]) == 2
    page = client.get("/api/v1/ai/chat/history?limit=1", headers=a).json()
    assert page["next_before"]
    older = client.get("/api/v1/ai/chat/history", headers=a, params={"before": page["next_before"]}).json()
    assert older["items"][0]["id"] == first.json()["message_id"]


def test_no_calendar_or_history_without_context_consent(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    event(client, headers)
    model = configure(app, {"type": "reply", "message": "Привет"})
    assert chat(client, headers).status_code == 200
    assert chat(client, headers, key="without-consent", planning_context_allowed=False).status_code == 200
    assert model.context["events"] == [] and model.context["history"] == []


def test_edit_applies_immediately_and_replay_does_not_duplicate(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    e = event(client, headers)
    configure(app, {"type":"update_event", "payload":{"event_id":e["id"], "version":e["version"], "title":"Changed", "scope":"all"}})
    result = chat(client, headers, "Rename")
    assert result.status_code == 200, result.text
    assert result.json()["confirmation"] is None
    current = client.get("/api/v1/planning/events/" + e["id"], headers=headers).json()
    assert current["title"] == "Changed"
    assert chat(client, headers, "Rename").json() == result.json()
    assert client.get("/api/v1/planning/events/" + e["id"], headers=headers).json()["version"] == current["version"]


def test_confirmation_owner_version_cancel_and_expiry(client, app, db, make_user, auth_headers):
    headers, other = auth_headers(make_user()), auth_headers(make_user())
    e = event(client, headers, rrule="FREQ=DAILY;COUNT=4")
    configure(app, {"type": "delete_event", "payload": {"event_id": e["id"], "version": e["version"], "scope": "all"}})
    proposal = chat(client, headers).json()
    url = "/api/v1/ai/chat/" + proposal["message_id"] + "/confirm"
    assert client.post(url, headers=other, json={"apply": True}).status_code == 404
    assert (
        client.patch(
            "/api/v1/planning/events/" + e["id"], headers=headers, json={"version": e["version"], "title": "Changed"}
        ).status_code
        == 200
    )
    assert client.post(url, headers=headers, json={"apply": True}).status_code == 409
    assert client.post(url, headers=headers, json={"apply": False}).json()["confirmation"] == "cancelled"
    assert client.post(url, headers=headers, json={"apply": True}).json()["confirmation"] == "cancelled"
    assert client.get("/api/v1/planning/events/" + e["id"], headers=headers).status_code == 200
    record = db.scalar(select(PlanningCommandRecord).where(PlanningCommandRecord.request_text.is_not(None)))
    response = dict(record.response)
    response["confirmation"] = "pending"
    record.response = response
    record.created_at = utcnow() - timedelta(days=2)
    db.commit()
    assert client.post(url, headers=headers, json={"apply": True}).json()["error"]["code"] == "proposal_expired"


def test_single_occurrence_edit_keeps_other_occurrences(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    e = event(client, headers, rrule="FREQ=DAILY;COUNT=3")
    occurrence = datetime.fromisoformat(e["start_at"]) + timedelta(days=1)
    configure(
        app,
        {
            "type": "update_event",
            "payload": {
                "event_id": e["id"],
                "version": e["version"],
                "scope": "this",
                "occurrence_at": occurrence.isoformat(),
                "title": "Разовая замена",
            },
        },
    )
    proposal = chat(client, headers).json()
    result = client.post(
        "/api/v1/ai/chat/" + proposal["message_id"] + "/confirm", headers=headers, json={"apply": True}
    )
    assert result.status_code == 200, result.text
    calendar = client.get(
        "/api/v1/planning/calendar",
        headers=headers,
        params={"from": e["start_at"], "to": (occurrence + timedelta(days=2)).isoformat(), "timezone": "UTC"},
    ).json()
    assert len(calendar["events"]) == 3
    assert [x["title"] for x in calendar["events"]].count("Разовая замена") == 1


def test_read_only_and_foreign_events_cannot_be_changed(client, app, db, make_user, auth_headers):
    from app.modules.planning.models import CalendarEvent
    from uuid import UUID

    owner, other = auth_headers(make_user()), auth_headers(make_user())
    e = event(client, owner)
    configure(app, {"type": "delete_event", "payload": {"event_id": e["id"], "version": e["version"], "scope": "all"}})
    assert chat(client, other).status_code == 404
    row = db.get(CalendarEvent, UUID(e["id"]))
    row.external_read_only = True
    db.commit()
    configure(app, {"type": "delete_event", "payload": {"event_id": e["id"], "version": row.version, "scope": "all"}})
    assert chat(client, owner).json()["error"]["code"] == "sync_conflict"


def test_nearest_tuesday_and_explicit_start():
    zone = ZoneInfo("Europe/Warsaw")
    now = datetime(2026, 10, 19, 12, tzinfo=zone)  # Monday, before DST change.

    def action():
        return ActionEnvelope.model_validate(
            {
                "action": {
                    "type": "create_event",
                    "payload": {
                        "title": "Пара",
                        "start_at": "2026-10-27T10:00:00+01:00",
                        "end_at": "2026-10-27T12:00:00+01:00",
                        "timezone": "Europe/Warsaw",
                        "rrule": "FREQ=WEEKLY;BYDAY=TU",
                    },
                }
            }
        ).action

    fixed = normalize_weekly_start(action(), "Добавь пару каждый вторник с 10 до 12", now, "Europe/Warsaw")
    assert fixed.payload.start_at == datetime(2026, 10, 20, 10, tzinfo=zone)
    assert fixed.payload.end_at == datetime(2026, 10, 20, 12, tzinfo=zone)
    explicit = normalize_weekly_start(action(), "Каждый вторник начиная с 27 октября", now, "Europe/Warsaw")
    assert explicit.payload.start_at.day == 27
    later = normalize_weekly_start(
        action(), "Каждый вторник с 10 до 12", datetime(2026, 10, 20, 11, tzinfo=zone), "Europe/Warsaw"
    )
    assert later.payload.start_at.day == 27


def test_dashboard_seven_days_owner_scope_and_missing_data(client, app, make_user, auth_headers):
    owner, other = auth_headers(make_user()), auth_headers(make_user())
    end = utcnow() - timedelta(hours=1)
    for headers, hours in [(owner, 7), (other, 10)]:
        response = client.post(
            "/api/v1/health/sleep",
            headers=headers,
            json={"start_at": (end - timedelta(hours=hours)).isoformat(), "end_at": end.isoformat(), "quality": 4},
        )
        assert response.status_code == 201, response.text
    widgets = client.get("/api/v1/dashboard", headers=owner).json()["widgets"]
    assert len(widgets["sleep_week"]) == 7
    assert [x["hours"] for x in widgets["sleep_week"] if x["hours"] is not None] == [7]
    assert sum(x["hours"] is None for x in widgets["sleep_week"]) == 6


def test_complete_reopen_and_delete_task_confirmations(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    task = client.post("/api/v1/planning/tasks", headers=headers, json={"title": "Check status"}).json()
    for index, completed in enumerate([True, False]):
        configure(
            app,
            {
                "type": "task_status",
                "payload": {"task_id": task["id"], "version": task["version"], "completed": completed},
            },
        )
        proposal = chat(client, headers, key=f"status-{index}").json()
        assert proposal["confirmation"] is None
        response = client.post(
            "/api/v1/ai/chat/" + proposal["message_id"] + "/confirm", headers=headers, json={"apply": True}
        )
        assert response.status_code == 200, response.text
        task = client.get("/api/v1/planning/tasks/" + task["id"], headers=headers).json()
        assert task["completed"] is completed
    configure(app, {"type": "delete_task", "payload": {"task_id": task["id"], "version": task["version"]}})
    proposal = chat(client, headers, key="delete").json()
    assert (
        client.post(
            "/api/v1/ai/chat/" + proposal["message_id"] + "/confirm", headers=headers, json={"apply": True}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/planning/tasks/" + task["id"], headers=headers).status_code == 404


def test_delete_one_occurrence_and_replay(client, app, make_user, auth_headers):
    headers = auth_headers(make_user())
    e = event(client, headers, rrule="FREQ=DAILY;COUNT=3")
    at = datetime.fromisoformat(e["start_at"]) + timedelta(days=1)
    configure(
        app,
        {
            "type": "delete_event",
            "payload": {"event_id": e["id"], "version": e["version"], "scope": "this", "occurrence_at": at.isoformat()},
        },
    )
    proposal = chat(client, headers).json()
    result = client.post(
        "/api/v1/ai/chat/" + proposal["message_id"] + "/confirm", headers=headers, json={"apply": True}
    )
    assert result.status_code == 200, result.text
    assert (
        client.post(
            "/api/v1/ai/chat/" + proposal["message_id"] + "/confirm", headers=headers, json={"apply": True}
        ).json()
        == result.json()
    )
    calendar = client.get(
        "/api/v1/planning/calendar",
        headers=headers,
        params={"from": e["start_at"], "to": (at + timedelta(days=2)).isoformat(), "timezone": "UTC"},
    ).json()
    assert len(calendar["events"]) == 2


def test_visible_old_task_is_in_context_even_after_recent_limit(client, app, db, make_user, auth_headers):
    from app.modules.planning.models import Task

    user = make_user()
    headers = auth_headers(user)
    visible = Task(user_id=user.id, title="Old visible", due_at=utcnow(), updated_at=utcnow() - timedelta(days=200))
    db.add(visible)
    for i in range(101):
        db.add(Task(user_id=user.id, title=f"Recent {i}"))
    db.commit()
    model = configure(app, {"type": "reply", "message": "Есть задача"})
    assert chat(client, headers).status_code == 200
    assert str(visible.id) in [x["id"] for x in model.context["tasks"]]


def test_history_export_contains_messages_without_command_keys(client, app, db, make_user, auth_headers):
    from app.modules.users.privacy import collect_data

    user = make_user()
    headers = auth_headers(user)
    configure(app, {"type": "reply", "message": "Ответ"})
    assert chat(client, headers).status_code == 200
    export = collect_data(db, user)
    assert export["assistant_history"][0]["reply"] == "Ответ"
    assert "idempotency_key" not in export["assistant_history"][0]
