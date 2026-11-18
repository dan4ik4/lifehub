"""Bounded owner-scoped planning context and conservative weekly date resolution."""

import re
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import select
from app.modules.planning.command_models import PlanningCommandRecord
from app.modules.planning.dependencies import EntitlementService
from app.modules.planning.service import PlanningService
from app.modules.planning.models import CalendarEvent, Task, ListItem


def build_context(db, user, now, payload, record_id, tasks, lists):
    zone = ZoneInfo(user.timezone)
    today = now.astimezone(zone).date()
    selected = payload.selected_day or today
    start = datetime.combine(selected - timedelta(days=7), time.min, zone)
    end = start + timedelta(days=38)
    calendar = (
        PlanningService(db, user).calendar_range(start, end, user.timezone)
        if payload.planning_context_allowed
        else {"events": [], "tasks": []}
    )
    recent = (
        db.scalars(
            select(PlanningCommandRecord)
            .where(
                PlanningCommandRecord.user_id == user.id,
                PlanningCommandRecord.id != record_id,
                PlanningCommandRecord.request_text.is_not(None),
            )
            .order_by(PlanningCommandRecord.created_at.desc())
            .limit(10)
        ).all()
        if payload.mode == "chat" and payload.planning_context_allowed
        else []
    )
    visible_ids = {item.task_id for item in calendar["tasks"][:150]}
    known_ids = {item.id for item in tasks}
    if visible_ids - known_ids:
        tasks = list(tasks) + list(
            db.scalars(
                select(Task).where(
                    Task.user_id == user.id, Task.deleted_at.is_(None), Task.id.in_(visible_ids - known_ids)
                )
            )
        )
    event_ids = {item.id for item in calendar["events"][:150]}
    series = (
        {
            item.id: item
            for item in db.scalars(
                select(CalendarEvent).where(CalendarEvent.user_id == user.id, CalendarEvent.id.in_(event_ids))
            )
        }
        if event_ids
        else {}
    )
    event_context = []
    for item in calendar["events"][:150]:
        # Send only fields needed to understand and edit plans, not connection identifiers.
        data = item.model_dump(
            mode="json",
            include={
                "id",
                "title",
                "notes",
                "start_at",
                "end_at",
                "timezone",
                "all_day",
                "source",
                "external_read_only",
                "version",
                "occurrence_at",
                "recurrence",
            },
        )
        if data["notes"]:
            data["notes"] = data["notes"][:2000]
        parent = series.get(item.id)
        if parent and item.recurrence:
            data["series_start_at"] = parent.start_at.isoformat()
            data["series_end_at"] = parent.end_at.isoformat()
        event_context.append(data)
    history = [
        {
            "user": r.request_text,
            "assistant": (r.response or {}).get("message", r.error_message),
            "confirmation": (r.response or {}).get("confirmation"),
            "resources": (r.response or {}).get("affected_resources", []),
        }
        for r in reversed(recent)
    ]
    photo_rows = [r for r in recent if r.request_photos and r.created_at >= now - timedelta(days=7)][:3] if payload.media_allowed else []
    photo_rows.reverse()
    photos = [photo for r in photo_rows for photo in r.request_photos][:3]
    return {
        "photos": photos,
        "photo_messages": [{"message": r.request_text, "created_at": r.created_at.isoformat(), "count": len(r.request_photos)} for r in photo_rows],
        "current_time": now.astimezone(zone).isoformat(),
        "timezone": user.timezone,
        "selected_day": selected.isoformat(),
        "pro_features": EntitlementService.is_pro(user),
        "next_weekdays": {
            name: (today + timedelta(days=(i - today.weekday()) % 7)).isoformat()
            for i, name in enumerate(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])
        },
        "history": history,
        "calendar_from": start.isoformat(),
        "calendar_to": end.isoformat(),
        "events": event_context,
        "task_occurrences": [t.model_dump(mode="json") for t in calendar["tasks"][:150]],
        "calendar_truncated": len(calendar["events"]) > 150 or len(calendar["tasks"]) > 150,
        "tasks": [
            {
                "id": str(t.id),
                "title": t.title,
                "version": t.version,
                "due_at": t.due_at.isoformat() if t.due_at else None,
                "start_at": t.start_at.isoformat() if t.start_at else None,
                "completed": t.completed_at is not None,
                "rrule": t.rrule,
            }
            for t in (tasks if payload.planning_context_allowed or payload.mode == "command" else [])
        ],
        "tasks_may_be_truncated": len(tasks) >= 100,
        "list_items": [{"id":str(i.id), "list_id":str(i.list_id), "title":i.title, "checked":i.checked, "quantity":str(i.quantity) if i.quantity else None, "unit":i.unit, "version":i.version} for i in db.scalars(select(ListItem).where(ListItem.user_id == user.id, ListItem.deleted_at.is_(None), ListItem.list_id.in_([l.id for l in lists])).limit(200))] if payload.planning_context_allowed else [],
        "lists": [{"id": str(l.id), "name": l.name, "kind": l.kind, "version": l.version} for l in lists] if payload.planning_context_allowed or payload.mode == "command" else [],
    }


def normalize_weekly_start(action, message, now, timezone):
    # Only a simple, unqualified weekly request. Explicit starts/intervals remain untouched.
    if action.type not in ("create_event", "create_task") or not action.payload.rrule:
        return action
    words = message.lower().replace("ё", "е")
    names = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"]
    matches = [i for i, name in enumerate(names) if re.search(r"кажд(?:ый|ую|ое)\s+" + name + r"\b", words)]
    if len(matches) != 1 or re.search(
        r"\d{4}|\d{1,2}[./]\d|(?:начиная|начать|через|следующ|этой недел|со следующ|с завтр|с понед)|(?:январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр)",
        words,
    ):
        return action
    p = action.payload
    try:
        parts = dict(part.split("=", 1) for part in p.rrule.upper().removeprefix("RRULE:").split(";"))
    except ValueError:
        return action  # Domain validation reports malformed rules.
    weekday = matches[0]
    if (
        parts.get("FREQ") != "WEEKLY"
        or parts.get("INTERVAL", "1") != "1"
        or parts.get("BYDAY") != ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][weekday]
    ):
        return action
    if any(k not in {"FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL", "WKST"} for k in parts):
        return action
    zone = ZoneInfo(p.timezone or timezone)
    anchor = p.start_at if action.type == "create_event" else (p.due_at or p.start_at)
    if not anchor:
        return action
    local_now, local_anchor = now.astimezone(zone), anchor.astimezone(zone)
    day = local_now.date() + timedelta(days=(weekday - local_now.weekday()) % 7)
    nearest = datetime.combine(day, local_anchor.timetz().replace(tzinfo=None), zone)
    if nearest <= local_now:
        nearest += timedelta(days=7)
    delta = nearest - local_anchor
    for key in ("start_at", "end_at", "due_at"):
        value = getattr(p, key, None)
        if value is not None:
            setattr(p, key, value.astimezone(zone) + delta)
    return action
