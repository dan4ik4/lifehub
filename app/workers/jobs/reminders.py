from datetime import timedelta
from uuid import uuid4

from sqlalchemy import or_, select, update

from app.core.database import utcnow
from app.modules.auth.models import User
from app.modules.planning.models import CalendarEvent, EventException, Reminder, Task, TaskOccurrence
from app.modules.planning.reminders import HttpReminderDelivery, ReminderService


def run_reminders(session, settings, delivery=None, now=None, batch_size=100):
    """Claim due work using PostgreSQL row locks and persisted two-minute leases.

    This function owns its session transaction. Pass a dedicated worker session.
    Crash retries reuse the same delivery key; transports must deduplicate it.
    """
    now = now or utcnow()
    from app.modules.notifications.service import WebPushReminderDelivery

    delivery = delivery or WebPushReminderDelivery(session, settings)
    due = list(
        session.scalars(
            select(Reminder)
            .where(
                Reminder.cancelled_at.is_(None),
                Reminder.next_trigger_at <= now,
                or_(Reminder.next_attempt_at.is_(None), Reminder.next_attempt_at <= now),
                or_(Reminder.lease_until.is_(None), Reminder.lease_until <= now),
            )
            .order_by(Reminder.next_trigger_at, Reminder.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
    )
    claims = []
    for reminder in due:
        token = uuid4()
        # CAS also prevents duplicate claims in SQLite tests and non-locking DBs.
        claimed = session.execute(
            update(Reminder)
            .where(Reminder.id == reminder.id, or_(Reminder.lease_until.is_(None), Reminder.lease_until <= now))
            .values(lease_until=now + timedelta(minutes=2), lease_token=token)
        )
        if claimed.rowcount:
            claims.append((reminder.id, token))
    session.commit()
    result = {"delivered": 0, "failed": 0, "skipped": 0}
    for reminder_id, token in claims:
        reminder = session.scalar(
            select(Reminder)
            .where(Reminder.id == reminder_id, Reminder.lease_token == token)
            .execution_options(populate_existing=True)
        )
        if reminder is None or reminder.cancelled_at:
            continue
        user = session.get(User, reminder.user_id)
        model = Task if reminder.entity_type == "task" else CalendarEvent
        entity = session.scalar(select(model).where(model.id == reminder.entity_id, model.user_id == reminder.user_id))
        if user is None or user.deleted_at or entity is None or entity.deleted_at:
            reminder.cancelled_at = now
            reminder.lease_until = reminder.lease_token = None
            session.commit()
            result["skipped"] += 1
            continue
        completed = reminder.entity_type == "task" and entity.completed_at is not None
        if reminder.occurrence_at:
            if reminder.entity_type == "task":
                completed = (
                    session.scalar(
                        select(TaskOccurrence.id).where(
                            TaskOccurrence.task_id == entity.id,
                            TaskOccurrence.occurrence_at == reminder.occurrence_at,
                            TaskOccurrence.status.in_(["completed", "skipped"]),
                        )
                    )
                    is not None
                )
            else:
                completed = (
                    session.scalar(
                        select(EventException.id).where(
                            EventException.event_id == entity.id, EventException.occurrence_at == reminder.occurrence_at
                        )
                    )
                    is not None
                )
        if completed:
            if not entity.rrule:
                reminder.next_trigger_at = None
                reminder.lease_until = reminder.lease_token = None
            else:
                ReminderService(session).advance(reminder, entity, now + timedelta(microseconds=1))
            session.commit()
            result["skipped"] += 1
            continue
        try:
            delivery.deliver(
                reminder=reminder, user=user, entity=entity, idempotency_key=f"lifehub-reminder/{reminder.delivery_key}"
            )
        except Exception as exc:
            # Store only an error category; provider response bodies may contain secrets.
            reminder.attempts += 1
            reminder.last_error = getattr(exc, "code", type(exc).__name__)[:100]
            reminder.next_attempt_at = now + timedelta(seconds=min(3600, 30 * 2 ** min(reminder.attempts - 1, 7)))
            reminder.lease_until = reminder.lease_token = None
            result["failed"] += 1
        else:
            reminder.delivered_at = now
            reminder.last_error = None
            ReminderService(session).advance(reminder, entity, now + timedelta(microseconds=1))
            result["delivered"] += 1
        session.commit()
    return result


PlanningReminderJob = run_reminders
