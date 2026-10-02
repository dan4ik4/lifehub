"""Durable per-occurrence notification deduplication with bounded retries."""

from datetime import datetime, time, timedelta, date
from uuid import UUID
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from sqlalchemy import select, func, delete
from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.auth.models import User
from app.modules.planning.dependencies import EntitlementService
from app.modules.notifications.models import ProductNotice, PushSubscription
from app.modules.notifications.service import WebPushReminderDelivery, configured
from app.modules.goals_habits.models import Habit, HabitCheckin
from app.modules.health.models import Medication, MedicationIntake
from app.modules.finance.models import Subscription, Budget, Transaction, Debt
from app.modules.finance.recurring import next_payment


def enqueue(db, user, key, module, url, expires, now, paid=False):
    # Each user's row is locked by the caller, including concurrent workers.
    if db.get(ProductNotice, key) is None:
        db.add(
            ProductNotice(
                key=key, user_id=user.id, module=module, url=url, expires_at=expires, retry_at=now, pro_only=paid
            )
        )


def schedule(db, now):
    users = db.scalars(
        select(User)
        .where(User.deleted_at.is_(None), User.id.in_(select(PushSubscription.user_id)))
        .with_for_update(skip_locked=True)
    ).all()
    for user in users:
        local = now.astimezone(ZoneInfo(user.timezone))
        day = local.date()
        pro = EntitlementService.is_pro(user)
        modules = {"planning", "goals_habits", "health", "finance", "books"} if pro else set(user.free_modules or [])

        def due(slot):
            stamp = datetime.combine(day, time.fromisoformat(slot), local.tzinfo)
            return timedelta(0) <= local - stamp < timedelta(minutes=15)

        if "goals_habits" in modules:
            for h in db.scalars(
                select(Habit).where(
                    Habit.user_id == user.id,
                    Habit.deleted_at.is_(None),
                    Habit.archived.is_(False),
                    Habit.reminder_time.is_not(None),
                )
            ):
                if day.weekday() not in h.weekdays or not due(h.reminder_time):
                    continue
                value = db.scalar(
                    select(HabitCheckin.value).where(HabitCheckin.habit_id == h.id, HabitCheckin.day == day)
                )
                if value is not None and value >= h.target:
                    continue
                enqueue(
                    db,
                    user,
                    f"habit:{h.id}:{day}",
                    "goals_habits",
                    "/modules/goals_habits",
                    now + timedelta(hours=2),
                    now,
                )
        if pro and "health" in modules:
            for m in db.scalars(
                select(Medication).where(Medication.user_id == user.id, Medication.deleted_at.is_(None))
            ):
                for slot in m.times:
                    if not due(slot):
                        continue
                    taken = db.scalar(
                        select(MedicationIntake.id).where(
                            MedicationIntake.medication_id == m.id,
                            MedicationIntake.day == day,
                            MedicationIntake.time == slot,
                            MedicationIntake.deleted_at.is_(None),
                        )
                    )
                    if taken:
                        continue
                    enqueue(
                        db,
                        user,
                        f"medicine:{m.id}:{day}:{slot}",
                        "health",
                        "/modules/health",
                        now + timedelta(hours=1),
                        now,
                        True,
                    )
        if pro and "finance" in modules:
            if due("09:00"):
                for sub in db.scalars(
                    select(Subscription).where(Subscription.user_id == user.id, Subscription.deleted_at.is_(None))
                ):
                    payment = next_payment(sub, day)
                    if payment == day + timedelta(days=1):
                        enqueue(
                            db,
                            user,
                            f"payment:{sub.id}:{payment}",
                            "finance",
                            "/modules/finance",
                            now + timedelta(hours=12),
                            now,
                            True,
                        )
                for debt in db.scalars(
                    select(Debt).where(
                        Debt.user_id == user.id,
                        Debt.deleted_at.is_(None),
                        Debt.status == "active",
                        Debt.due_date == day + timedelta(days=1),
                    )
                ):
                    enqueue(
                        db,
                        user,
                        f"debt:{debt.id}:{debt.due_date}",
                        "finance",
                        "/modules/finance",
                        now + timedelta(hours=12),
                        now,
                        True,
                    )
            for budget in db.scalars(
                select(Budget).where(
                    Budget.user_id == user.id, Budget.deleted_at.is_(None), Budget.month == day.strftime("%Y-%m")
                )
            ):
                spent = db.scalar(
                    select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                        Transaction.user_id == user.id,
                        Transaction.deleted_at.is_(None),
                        Transaction.kind == "expense",
                        Transaction.currency == budget.currency,
                        Transaction.category == budget.category,
                        Transaction.day >= day.replace(day=1),
                        Transaction.day <= day,
                    )
                )
                threshold = 100 if spent > budget.amount else 80 if spent > budget.amount * 80 / 100 else None
                if threshold:
                    enqueue(
                        db,
                        user,
                        f"budget:{budget.id}:{budget.month}:{threshold}",
                        "finance",
                        "/modules/finance",
                        now + timedelta(days=1),
                        now,
                        True,
                    )
    db.commit()


def still_relevant(db, item, user, now):
    """Cancel queued reminders when their source changed during a delivery retry."""
    parts = item.key.split(":")
    kind, identifier = parts[:2]
    model = {"habit": Habit, "medicine": Medication, "payment": Subscription, "debt": Debt, "budget": Budget}.get(kind)
    if model is None:
        return False
    source = db.get(model, UUID(identifier))
    if source is None or source.user_id != user.id or source.deleted_at is not None:
        return False
    if kind == "habit":
        day = date.fromisoformat(parts[2])
        value = db.scalar(select(HabitCheckin.value).where(HabitCheckin.habit_id == source.id, HabitCheckin.day == day))
        return (
            not source.archived
            and day.weekday() in source.weekdays
            and bool(source.reminder_time)
            and (value is None or value < source.target)
        )
    if kind == "medicine":
        day, slot = date.fromisoformat(parts[2]), ":".join(parts[3:])
        taken = db.scalar(
            select(MedicationIntake.id).where(
                MedicationIntake.medication_id == source.id,
                MedicationIntake.day == day,
                MedicationIntake.time == slot,
                MedicationIntake.deleted_at.is_(None),
            )
        )
        return slot in source.times and taken is None
    if kind == "debt":
        return source.status == "active" and str(source.due_date) == parts[2]
    if kind == "payment":
        return str(next_payment(source, now.astimezone(ZoneInfo(user.timezone)).date())) == parts[2]
    day = now.astimezone(ZoneInfo(user.timezone)).date()
    if source.month != day.strftime("%Y-%m"):
        return False
    spent = db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user.id,
            Transaction.deleted_at.is_(None),
            Transaction.kind == "expense",
            Transaction.currency == source.currency,
            Transaction.category == source.category,
            Transaction.day >= day.replace(day=1),
            Transaction.day <= day,
        )
    )
    return spent > source.amount * int(parts[-1]) / 100


def run_product_notifications(db, settings, delivery=None, now=None):
    now = now or utcnow()
    if not configured(settings) and delivery is None:
        return {"delivered": 0}
    schedule(db, now)
    sent = 0
    for _ in range(100):
        item = db.scalar(
            select(ProductNotice)
            .where(
                ProductNotice.delivered_at.is_(None),
                ProductNotice.expires_at > now,
                ProductNotice.retry_at <= now,
                ProductNotice.attempts < 5,
            )
            .order_by(ProductNotice.retry_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if item is None:
            break
        user = db.get(User, item.user_id)
        pro = bool(user and EntitlementService.is_pro(user))
        if (
            not user
            or user.deleted_at
            or (item.pro_only and not pro)
            or (not pro and item.module not in (user.free_modules or []))
            or not still_relevant(db, item, user, now)
        ):
            item.expires_at = now
            db.commit()
            continue
        item.attempts += 1
        item.retry_at = now + timedelta(minutes=2**item.attempts)
        try:
            sender = delivery or WebPushReminderDelivery(db, settings)
            sender.deliver(
                reminder=SimpleNamespace(channel="push"),
                user=user,
                entity=SimpleNamespace(notification_url=item.url),
                idempotency_key=item.key,
            )
            item.delivered_at = now
            sent += 1
        except AppError:
            pass
        db.commit()
    db.execute(delete(ProductNotice).where(ProductNotice.expires_at < now - timedelta(days=32)))
    db.commit()
    return {"delivered": sent}
