from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends
from sqlalchemy import case, select, func
from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.owned import lock_user, record
from app.modules.auth.dependencies import get_current_user
from app.modules.planning.dependencies import EntitlementService
from app.modules.planning.service import PlanningService
from app.modules.planning.models import Task
from app.modules.goals_habits.models import Goal
from app.modules.goals_habits.routes import goal_data
from app.modules.dashboard.day_progress import day_streaks, observe_day, todays_habits
from app.modules.health.models import SleepEntry, WeightEntry, Workout
from app.modules.books.models import Book
from app.modules.finance.models import Transaction, Budget

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("")
def dashboard(user=Depends(get_current_user), db=Depends(get_db)):
    pro = EntitlementService.is_pro(user)
    modules = ["planning", "goals_habits", "health", "finance", "books"] if pro else (user.free_modules or [])
    day = utcnow().astimezone(ZoneInfo(user.timezone)).date()
    start = datetime.combine(day, time.min, ZoneInfo(user.timezone))
    end = start + timedelta(days=1)
    result = {"day": day, "modules": modules, "widgets": {}, "day_progress": day_streaks(db, user, day)}
    widgets = result["widgets"]
    if "planning" in modules:
        service = PlanningService(db, user)
        calendar = service.day_agenda(day)
        ids = [x.task_id for x in calendar["tasks"]]
        tasks = (
            {t.id: t for t in db.scalars(select(Task).where(Task.user_id == user.id, Task.id.in_(ids)))} if ids else {}
        )
        widgets["planning"] = {
            "tasks": [
                {"task": service.task_response(tasks[o.task_id]), "occurrence": o}
                for o in calendar["tasks"]
                if o.task_id in tasks
            ],
            "events": calendar["events"],
            "spanning_tasks": calendar["spanning_tasks"],
        }
    if "goals_habits" in modules:
        widgets["habits"] = [{**record(h), "today_value": value, "today_complete": value >= h.target}
                             for h, value in todays_habits(db, user, day)]
        goals = db.scalars(
            select(Goal)
            .where(Goal.user_id == user.id, Goal.deleted_at.is_(None), Goal.status == "active")
            .order_by(Goal.updated_at.desc())
            .limit(3)
        ).all()
        widgets["goals"] = [
            {"id": g.id, "title": g.title, "progress": goal_data(db, user, g)["progress"], "due_date": g.due_date} for g in goals
        ]
    if "health" in modules:
        sleeps = db.scalars(
            select(SleepEntry)
            .where(
                SleepEntry.user_id == user.id,
                SleepEntry.deleted_at.is_(None),
                SleepEntry.end_at >= start - timedelta(days=6),
                SleepEntry.end_at < end,
            )
            .order_by(SleepEntry.end_at)
        ).all()
        sleep = sleeps[-1] if sleeps else None
        widgets["sleep"] = (
            {**record(sleep), "hours": round((sleep.end_at - sleep.start_at).total_seconds() / 3600, 1)}
            if sleep
            else None
        )
        daily = {}
        for item in sleeps:
            key = item.end_at.astimezone(ZoneInfo(user.timezone)).date()
            daily[key] = daily.get(key, 0) + (item.end_at - item.start_at).total_seconds() / 3600
        from app.modules.health.device_routes import device_days
        imported = device_days(db, user, day - timedelta(days=6), day)
        widgets["device_health"] = imported
        # Manual sleep is an explicit user entry and takes precedence for that day.
        for snapshot in imported:
            if snapshot["sleep_seconds"] is not None and snapshot["day"] not in daily:
                daily[snapshot["day"]] = snapshot["sleep_seconds"] / 3600
        latest = next((s for s in reversed(imported) if s["sleep_seconds"] is not None), None)
        if latest and (not sleep or latest["day"] > sleep.end_at.astimezone(ZoneInfo(user.timezone)).date()):
            widgets["sleep"] = {"hours": round(latest["sleep_seconds"] / 3600, 1), "day": latest["day"], "source": latest["provider"]}
        widgets["sleep_week"] = [
            {
                "day": day - timedelta(days=i),
                "hours": round(daily[day - timedelta(days=i)], 1) if day - timedelta(days=i) in daily else None,
            }
            for i in range(6, -1, -1)
        ]
        weights = db.scalars(
            select(WeightEntry)
            .where(WeightEntry.user_id == user.id, WeightEntry.deleted_at.is_(None), WeightEntry.day <= day)
            .order_by(WeightEntry.day.desc(), WeightEntry.created_at.desc())
            .limit(7)
        ).all()
        widgets["weight"] = [{"day": w.day, "kg": str(w.kg)} for w in reversed(weights)]
        workout_rows = db.execute(
            select(func.count(), func.coalesce(func.sum(Workout.minutes), 0),
                   func.coalesce(func.sum(case((Workout.day == day, Workout.minutes), else_=0)), 0)).where(
                Workout.user_id == user.id,
                Workout.deleted_at.is_(None),
                Workout.day >= day - timedelta(days=6),
                Workout.day <= day,
            )
        ).one()
        widgets["workouts"] = {"count": workout_rows[0], "minutes": workout_rows[1], "today_minutes": workout_rows[2]}
    if "books" in modules:
        books = db.scalars(
            select(Book)
            .where(Book.user_id == user.id, Book.deleted_at.is_(None), Book.status == "reading")
            .order_by(Book.updated_at.desc())
            .limit(3)
        ).all()
        widgets["books"] = [
            {
                "id": b.id,
                "title": b.title,
                "author": b.author,
                "cover_id": b.cover_id,
                "current_page": b.current_page,
                "total_pages": b.total_pages,
            }
            for b in books
        ]
    if "finance" in modules:
        rows = db.execute(
            select(Transaction.currency, Transaction.kind, func.sum(Transaction.amount))
            .where(
                Transaction.user_id == user.id,
                Transaction.deleted_at.is_(None),
                Transaction.day >= day.replace(day=1),
                Transaction.day <= day,
            )
            .group_by(Transaction.currency, Transaction.kind)
        ).all()
        widgets["finance"] = [
            {"currency": currency, "kind": kind, "amount": str(amount)} for currency, kind, amount in rows
        ]
        if pro:
            spent_rows = db.execute(
                select(Transaction.currency, Transaction.category, func.sum(Transaction.amount))
                .where(
                    Transaction.user_id == user.id,
                    Transaction.deleted_at.is_(None),
                    Transaction.kind == "expense",
                    Transaction.day >= day.replace(day=1),
                    Transaction.day <= day,
                )
                .group_by(Transaction.currency, Transaction.category)
            ).all()
            spent = {(currency, category): amount for currency, category, amount in spent_rows}
            budgets = db.scalars(
                select(Budget)
                .where(Budget.user_id == user.id, Budget.deleted_at.is_(None), Budget.month == day.strftime("%Y-%m"))
                .order_by(Budget.category)
                .limit(100)
            ).all()
            widgets["budgets"] = [
                {
                    "id": b.id,
                    "category": b.category,
                    "currency": b.currency,
                    "amount": str(b.amount),
                    "remaining": str(b.amount - spent.get((b.currency, b.category), 0)),
                    "percent": round(100 * spent.get((b.currency, b.category), 0) / b.amount),
                }
                for b in budgets
            ]
    return result


@router.post("/close-day")
def close_day(user=Depends(get_current_user), db=Depends(get_db)):
    lock_user(db, user)
    observe_day(db, user)
    db.commit()
    return day_streaks(db, user, utcnow().astimezone(ZoneInfo(user.timezone)).date())
