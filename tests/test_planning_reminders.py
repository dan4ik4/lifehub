from datetime import timedelta

from sqlalchemy import select

from app.core.database import utcnow
from app.modules.planning.models import Reminder
from app.modules.planning.reminders import MemoryReminderDelivery
from app.modules.planning.schemas import ReminderCreate, TaskCreate
from app.modules.planning.service import PlanningService
from app.workers.jobs.reminders import run_reminders


def test_due_delivery_idempotent_and_not_repeated(db, make_user, settings):
    now = utcnow()
    service = PlanningService(db, make_user())
    service.create_task(TaskCreate(title="Medicine", due_at=now - timedelta(minutes=1), reminders=[ReminderCreate(offset_minutes=0)]))
    delivery = MemoryReminderDelivery()
    assert run_reminders(db, settings, delivery, now)["delivered"] == 1
    assert run_reminders(db, settings, delivery, now + timedelta(minutes=5))["delivered"] == 0
    assert len(delivery.messages) == 1
    assert db.scalar(select(Reminder)).delivered_at is not None


def test_provider_unconfigured_never_marks_delivered_and_retries(db, make_user, settings):
    now = utcnow()
    PlanningService(db, make_user()).create_task(TaskCreate(title="Reminder", reminders=[ReminderCreate(trigger_at=now - timedelta(seconds=1))]))
    assert run_reminders(db, settings, now=now)["failed"] == 1
    reminder = db.scalar(select(Reminder))
    assert reminder.delivered_at is None
    assert reminder.last_error == "provider_unavailable"
    original_key = reminder.delivery_key
    assert run_reminders(db, settings, now=now + timedelta(seconds=1))["failed"] == 0
    delivery = MemoryReminderDelivery()
    assert run_reminders(db, settings, delivery, now + timedelta(seconds=31))["delivered"] == 1
    assert delivery.messages[0]["key"] == f"lifehub-reminder/{original_key}"


def test_lease_blocks_parallel_claim_and_recovers_after_crash(db, make_user, settings):
    now = utcnow()
    PlanningService(db, make_user()).create_task(TaskCreate(title="Reminder", reminders=[ReminderCreate(trigger_at=now - timedelta(seconds=1))]))
    reminder = db.scalar(select(Reminder))
    reminder.lease_until = now + timedelta(minutes=2)
    db.commit()
    delivery = MemoryReminderDelivery()
    assert run_reminders(db, settings, delivery, now)["delivered"] == 0
    assert run_reminders(db, settings, delivery, now + timedelta(minutes=3))["delivered"] == 1


def test_deleted_entity_cancels_delivery(db, make_user, settings):
    now = utcnow()
    service = PlanningService(db, make_user())
    item = service.create_task(TaskCreate(title="Reminder", reminders=[ReminderCreate(trigger_at=now - timedelta(seconds=1))]))
    service.delete_task(item.id)
    delivery = MemoryReminderDelivery()
    assert run_reminders(db, settings, delivery, now)["delivered"] == 0
    assert db.scalar(select(Reminder)).cancelled_at is not None
