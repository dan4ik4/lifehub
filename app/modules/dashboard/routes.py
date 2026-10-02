from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.owned import record
from app.modules.auth.dependencies import get_current_user
from app.modules.planning.dependencies import EntitlementService
from app.modules.planning.service import PlanningService
from app.modules.planning.models import Task
from app.modules.goals_habits.models import Habit
from app.modules.goals_habits.routes import habit_data
from app.modules.health.models import SleepEntry
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
    result = {"day": day, "modules": modules, "widgets": {}}
    widgets = result["widgets"]
    if "planning" in modules:
        service = PlanningService(db, user)
        calendar = service.calendar_range(start, end, user.timezone)
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
        }
    if "goals_habits" in modules:
        habits = db.scalars(
            select(Habit)
            .where(Habit.user_id == user.id, Habit.deleted_at.is_(None), Habit.archived.is_(False))
            .order_by(Habit.created_at)
            .limit(100)
        ).all()
        widgets["habits"] = [habit_data(db, user, h) for h in habits if day.weekday() in h.weekdays]
    if "health" in modules:
        sleep = db.scalar(
            select(SleepEntry)
            .where(
                SleepEntry.user_id == user.id,
                SleepEntry.deleted_at.is_(None),
                SleepEntry.end_at >= start - timedelta(days=6),
                SleepEntry.end_at < end,
            )
            .order_by(SleepEntry.end_at.desc())
            .limit(1)
        )
        widgets["sleep"] = (
            {**record(sleep), "hours": round((sleep.end_at - sleep.start_at).total_seconds() / 3600, 1)}
            if sleep
            else None
        )
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
