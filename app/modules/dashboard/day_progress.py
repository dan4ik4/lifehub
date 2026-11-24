from datetime import date, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Date, ForeignKey, and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, utcnow
from app.core.errors import AppError
from app.modules.goals_habits.models import Habit, HabitCheckin
from app.modules.health.models import Workout
from app.modules.planning.dependencies import EntitlementService


MOVEMENT_MINUTES = 30


class ClosedDay(Base):
    __tablename__ = "dashboard_closed_days"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)


def todays_habits(db, user, day):
    rows = db.execute(
        select(Habit, HabitCheckin.value)
        .outerjoin(HabitCheckin, and_(HabitCheckin.habit_id == Habit.id, HabitCheckin.user_id == user.id,
                                     HabitCheckin.day == day, HabitCheckin.deleted_at.is_(None)))
        .where(Habit.user_id == user.id, Habit.deleted_at.is_(None), Habit.archived.is_(False))
        .order_by(Habit.created_at, Habit.id)
    )
    return [(habit, value or 0) for habit, value in rows if day.weekday() in habit.weekdays]


def mark_closed(db, user, day):
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    db.execute(insert(ClosedDay).values(user_id=user.id, day=day).on_conflict_do_nothing(
        index_elements=[ClosedDay.user_id, ClosedDay.day]))


def observe_day(db, user):
    if not EntitlementService.is_pro(user) and not {"health", "goals_habits", "planning"} <= set(user.free_modules or []):
        return
    day = utcnow().astimezone(ZoneInfo(user.timezone)).date()
    if db.get(ClosedDay, (user.id, day)) is not None:
        return
    minutes = db.scalar(select(func.sum(Workout.minutes)).where(
        Workout.user_id == user.id, Workout.day == day, Workout.deleted_at.is_(None)))
    if (minutes or 0) < MOVEMENT_MINUTES:
        return
    habits = todays_habits(db, user, day)
    if not habits or any(value < habit.target for habit, value in habits):
        return
    from app.modules.planning.service import PlanningService
    try:
        calendar = PlanningService(db, user).day_agenda(day, include_events=False)
    except AppError as exc:
        # A calendar above the supported read limit must not prevent saving a workout or check-in.
        if exc.code in {"invalid_or_large_range", "recurrence_too_complex"}:
            return
        raise
    tasks = [task for task in calendar["tasks"] if task.status != "skipped"]
    if tasks and all(task.status == "completed" for task in tasks):
        mark_closed(db, user, day)


def day_streaks(db, user, day):
    days = db.scalars(select(ClosedDay.day).where(ClosedDay.user_id == user.id, ClosedDay.day <= day)
                      .order_by(ClosedDay.day))
    previous = first = None
    current = best = 0
    for closed in days:
        first = first or closed
        current = current + 1 if previous and closed == previous + timedelta(days=1) else 1
        best = max(best, current)
        previous = closed
    return {"closed": previous == day, "current": current if previous in (day, day - timedelta(days=1)) else 0,
            "best": best, "first_closed": first, "movement_target": MOVEMENT_MINUTES}
