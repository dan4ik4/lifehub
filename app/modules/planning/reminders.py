"""Persistent reminder definitions and transport adapters.

Push is delivered to the deployment's authenticated notification gateway. The
gateway must durably enqueue and deduplicate the Idempotency-Key before returning
2xx. Email uses Resend's idempotency key. No transport means retry, never success.
"""
from datetime import timedelta
from typing import Protocol
from uuid import uuid4

import httpx
from sqlalchemy import select

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.planning.models import EventException, Reminder, TaskOccurrence
from app.modules.planning.recurrence import RecurrenceService
from app.modules.planning.schemas import ReminderCreate


class ReminderDelivery(Protocol):
    def deliver(self, *, reminder, user, entity, idempotency_key: str) -> None: ...


class HttpReminderDelivery:
    def __init__(self, settings, client=None):
        self.settings = settings
        self.client = client

    def deliver(self, *, reminder, user, entity, idempotency_key):
        if reminder.channel == "email":
            if not self.settings.resend_api_key:
                raise AppError(503, "provider_unavailable", "Reminder email is not configured")
            url = "https://api.resend.com/emails"
            headers = {"Authorization": f"Bearer {self.settings.resend_api_key}", "Idempotency-Key": idempotency_key}
            payload = {"from": self.settings.email_from, "to": [user.email], "subject": f"Life Hub: {entity.title}", "text": f"Reminder: {entity.title}\n\n{entity.notes or ''}"}
        else:
            if not self.settings.reminder_webhook_url or not self.settings.reminder_webhook_token:
                raise AppError(503, "provider_unavailable", "Reminder push gateway is not configured")
            url = self.settings.reminder_webhook_url
            if not url.startswith("https://") and self.settings.environment != "test":
                raise AppError(503, "provider_unavailable", "Reminder push gateway requires HTTPS")
            headers = {"Authorization": f"Bearer {self.settings.reminder_webhook_token}", "Idempotency-Key": idempotency_key}
            payload = {"reminder_id": str(reminder.id), "user_id": str(user.id), "entity_type": reminder.entity_type, "entity_id": str(entity.id), "title": entity.title, "notes": entity.notes, "occurrence_at": reminder.occurrence_at.isoformat() if reminder.occurrence_at else None}
        if self.client is not None:
            response = self.client.post(url, json=payload, headers=headers, timeout=15)
        else:
            with httpx.Client(follow_redirects=False, timeout=15) as client:
                response = client.post(url, json=payload, headers=headers)
        if not 200 <= response.status_code < 300:
            raise AppError(502, "delivery_failed", "Reminder provider rejected delivery")


class ReminderService:
    def __init__(self, session):
        self.session = session

    def replace(self, entity_type, entity, definitions=None, *, rearm=False):
        existing = list(self.session.scalars(select(Reminder).where(Reminder.user_id == entity.user_id, Reminder.entity_type == entity_type, Reminder.entity_id == entity.id, Reminder.cancelled_at.is_(None))))
        now = utcnow()
        if definitions is None:
            # Keep each idempotency key while an unchanged scheduled delivery is retried.
            for reminder in existing:
                old_trigger = reminder.next_trigger_at
                old_occurrence = reminder.occurrence_at
                if rearm and reminder.trigger_at is None:
                    # A newly scheduled deadline needs its own delivery even
                    # when the previous deadline's reminder was already sent.
                    reminder.delivered_at = None
                self.schedule(reminder, entity, now)
                if old_trigger != reminder.next_trigger_at or old_occurrence != reminder.occurrence_at:
                    reminder.delivery_key = str(uuid4())
                    reminder.attempts = 0
                    reminder.next_attempt_at = None
                    reminder.lease_until = reminder.lease_token = None
            return
        for reminder in existing:
            reminder.cancelled_at = now
        for definition in definitions:
            if not isinstance(definition, ReminderCreate):
                definition = ReminderCreate.model_validate(definition)
            reminder = Reminder(user_id=entity.user_id, entity_type=entity_type, entity_id=entity.id, **definition.model_dump())
            self.schedule(reminder, entity, now)
            self.session.add(reminder)

    def schedule(self, reminder, entity, after):
        from app.modules.planning.service import anchor, effective_time
        if entity.deleted_at is not None:
            reminder.next_trigger_at = None
            return
        if reminder.trigger_at is not None:
            # Absolute reminders are one-shot, even on a recurring entity.
            reminder.next_trigger_at = reminder.trigger_at if reminder.delivered_at is None else None
            reminder.occurrence_at = None
            return
        offset = timedelta(minutes=reminder.offset_minutes or 0)
        base = anchor(entity) if reminder.entity_type == "task" else entity.start_at
        target = (entity.due_at or entity.start_at) if reminder.entity_type == "task" else entity.start_at
        if target is None:
            raise AppError(422, "validation_error", "An offset reminder needs a scheduled task or event")
        if not entity.rrule:
            reminder.next_trigger_at = target - offset if reminder.delivered_at is None else None
            reminder.occurrence_at = None
            return
        if reminder.entity_type == "event":
            excluded = set(self.session.scalars(select(EventException.occurrence_at).where(EventException.event_id == entity.id, EventException.user_id == entity.user_id)))
        else:
            excluded = set(self.session.scalars(select(TaskOccurrence.occurrence_at).where(TaskOccurrence.task_id == entity.id, TaskOccurrence.user_id == entity.user_id, TaskOccurrence.status.in_(["completed", "skipped"]))))
        # Allow a day of DST displacement around the difference between start/due.
        lower = after + offset - (target - base) - timedelta(days=1)
        for occurrence in RecurrenceService.occurrences(entity.rrule, base, entity.timezone, lower, after + timedelta(days=366 * 100)):
            trigger = effective_time(target, base, occurrence, entity.timezone) - offset
            if trigger >= after and occurrence not in excluded:
                reminder.next_trigger_at, reminder.occurrence_at = trigger, occurrence
                return
        reminder.next_trigger_at = None

    def advance(self, reminder, entity, after):
        self.schedule(reminder, entity, after)
        reminder.delivery_key = str(uuid4())
        reminder.attempts = 0
        reminder.next_attempt_at = None
        reminder.lease_until = reminder.lease_token = None


class MemoryReminderDelivery:
    """Explicit test adapter with the same idempotency semantics as the gateway."""
    def __init__(self):
        self.messages = []
        self.keys = set()

    def deliver(self, *, reminder, user, entity, idempotency_key):
        if idempotency_key not in self.keys:
            self.messages.append({"user_id": str(user.id), "entity_id": str(entity.id), "key": idempotency_key})
            self.keys.add(idempotency_key)
