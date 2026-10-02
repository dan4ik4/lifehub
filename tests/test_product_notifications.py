from datetime import timedelta, date
from zoneinfo import ZoneInfo
from types import SimpleNamespace
from sqlalchemy import select
from app.core.database import utcnow
from app.modules.notifications.models import PushSubscription, ProductNotice
from app.modules.goals_habits.models import Habit
from app.workers.jobs.product_notifications import run_product_notifications
from app.modules.finance.recurring import next_payment


def test_habit_notification_is_deduplicated_and_owner_scoped(db, settings, make_user):
    user = make_user()
    other = make_user()
    now = utcnow()
    slot = now.astimezone(ZoneInfo(user.timezone)).strftime("%H:%M")
    db.add(PushSubscription(user_id=user.id, endpoint_hash="a" * 64, encrypted_subscription="test-only"))
    db.add(Habit(user_id=user.id, title="Read", kind="boolean", target=1, weekdays=list(range(7)), reminder_time=slot))
    db.add(
        Habit(user_id=other.id, title="Private", kind="boolean", target=1, weekdays=list(range(7)), reminder_time=slot)
    )
    db.commit()
    calls = []

    class Sender:
        def deliver(self, **kwargs):
            calls.append(kwargs)

    assert run_product_notifications(db, settings, Sender(), now)["delivered"] == 1
    assert run_product_notifications(db, settings, Sender(), now)["delivered"] == 0
    assert len(calls) == 1 and calls[0]["user"].id == user.id
    assert calls[0]["entity"].notification_url == "/modules/goals_habits"


def test_monthly_schedule_preserves_original_day():
    sub = SimpleNamespace(next_payment=date(2026, 1, 31), period="monthly")
    assert next_payment(sub, date(2026, 2, 1)) == date(2026, 2, 28)
    assert next_payment(sub, date(2026, 3, 1)) == date(2026, 3, 31)
    sub.period = "yearly"
    sub.next_payment = date(2024, 2, 29)
    assert next_payment(sub, date(2025, 1, 1)) == date(2025, 2, 28)


def test_retry_does_not_remind_deleted_habit(db, settings, make_user):
    from app.workers.jobs.product_notifications import schedule

    user = make_user()
    now = utcnow()
    db.add(PushSubscription(user_id=user.id, endpoint_hash="b" * 64, encrypted_subscription="test"))
    habit = Habit(
        user_id=user.id,
        title="Read",
        kind="boolean",
        target=1,
        weekdays=list(range(7)),
        reminder_time=now.astimezone(ZoneInfo(user.timezone)).strftime("%H:%M"),
    )
    db.add(habit)
    db.commit()
    schedule(db, now)
    assert db.scalar(select(ProductNotice)) is not None
    habit.deleted_at = now
    db.commit()

    class Sender:
        def deliver(self, **kwargs):
            raise AssertionError("Deleted source must not send")

    assert run_product_notifications(db, settings, Sender(), now)["delivered"] == 0
