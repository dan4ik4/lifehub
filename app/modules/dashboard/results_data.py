"""Owner-scoped daily facts for the three Results views."""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from statistics import mean
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.core.errors import AppError
from app.modules.books.models import Book, DiaryEntry
from app.modules.dashboard.insight_data import compare
from app.modules.dashboard.results_models import ReadingDelta
from app.modules.finance.models import Budget, Transaction
from app.modules.goals_habits.models import Habit, HabitCheckin
from app.modules.health.device_routes import device_days
from app.modules.health.models import HealthConnection, SleepEntry, Workout
from app.modules.planning.dependencies import EntitlementService
from app.modules.planning.models import Task, TaskOccurrence
from app.modules.planning.service import PlanningService

MODULES = ("planning", "goals_habits", "health", "finance", "books")
WEIGHTS = {"habits": 40, "tasks": 20, "sleep": 20, "mood": 20}
FACTS = ("tasks", "habits", "sleep", "workouts", "expenses", "pages", "mood")
METRICS = {
    "sleep": ("health", "Сон", "ч"),
    "habits": ("goals_habits", "Привычки", "%"),
    "expenses": ("finance", "Траты", ""),
    "mood": ("books", "Настроение", "из 5"),
    "workouts": ("health", "Тренировки", "мин"),
    "tasks": ("planning", "Задачи", ""),
    "steps": ("health", "Шаги", ""),
}
PAIRS = (("sleep", "habits"), ("expenses", "mood"), ("workouts", "sleep"), ("tasks", "mood"), ("steps", "sleep"))
PAIR_IDS = {":".join(keys) for keys in PAIRS}


def eligible(user):
    return set(MODULES) if EntitlementService.is_pro(user) else set(user.free_modules or [])


def dates(first, last):
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def group_by_day(db, model, user, first, last, *fields):
    return db.execute(
        select(model.day, *fields).where(model.user_id == user.id, model.deleted_at.is_(None),
            model.day.between(first, last)).group_by(model.day)
    )


def collect(db, user, first, last, *, planned=True):
    """Keep missing observations null. Only count explicit zeroes or scheduled work."""
    modules = eligible(user)
    zone = ZoneInfo(user.timezone)
    lower = datetime.combine(first, time.min, zone)
    upper = datetime.combine(last + timedelta(days=1), time.min, zone)
    rows = {day: {"day": day.isoformat(), **dict.fromkeys(FACTS), "task_total": None,
                 "habit_done": None, "habit_total": None, "workout_minutes": None,
                 "steps": None, "expenses": {}, "books": None} for day in dates(first, last)}
    if not rows:
        return []
    if "planning" in modules:
        completed = db.scalars(select(Task.completed_at).where(Task.user_id == user.id,
            Task.deleted_at.is_(None), Task.rrule.is_(None), Task.completed_at >= lower, Task.completed_at < upper)).all()
        repetitions = db.scalars(select(TaskOccurrence.completed_at).join(Task, Task.id == TaskOccurrence.task_id)
            .where(TaskOccurrence.user_id == user.id, Task.user_id == user.id, Task.deleted_at.is_(None),
                TaskOccurrence.status == "completed", TaskOccurrence.completed_at >= lower,
                TaskOccurrence.completed_at < upper)).all()
        for stamp in completed + repetitions:
            row = rows[stamp.astimezone(zone).date()]
            row["tasks"] = (row["tasks"] or 0) + 1
        if planned:
            service = PlanningService(db, user)
            for day, row in rows.items():
                try:
                    agenda = service.day_agenda(day, include_events=False)
                except AppError as error:
                    if error.code == "invalid_or_large_range":
                        continue
                    raise
                total = sum(task.status != "skipped" for task in agenda["tasks"])
                if total or row["tasks"]:
                    row["task_total"] = max(total, row["tasks"] or 0)
                    row["tasks"] = row["tasks"] or 0
    if "goals_habits" in modules:
        habits = db.scalars(select(Habit).where(Habit.user_id == user.id, Habit.deleted_at.is_(None))).all()
        checkins = {(habit_id, day): value for habit_id, day, value in db.execute(
            select(HabitCheckin.habit_id, HabitCheckin.day, HabitCheckin.value)
            .where(HabitCheckin.user_id == user.id, HabitCheckin.deleted_at.is_(None), HabitCheckin.day.between(first, last)))}
        for day, row in rows.items():
            scheduled = [habit for habit in habits if (habit.id, day) in checkins or
                (not habit.archived and habit.created_at.astimezone(zone).date() <= day and day.weekday() in habit.weekdays)]
            if scheduled:
                done = sum(checkins.get((habit.id, day), 0) >= habit.target for habit in scheduled)
                row.update(habits=round(100 * done / len(scheduled)), habit_done=done, habit_total=len(scheduled))
    if "health" in modules:
        intervals = db.execute(select(SleepEntry.start_at, SleepEntry.end_at).where(SleepEntry.user_id == user.id,
            SleepEntry.deleted_at.is_(None), SleepEntry.end_at >= lower, SleepEntry.end_at < upper)
            .order_by(SleepEntry.start_at)).all()
        durations, invalid = {}, set()
        cluster_end, cluster_days = None, set()
        for start, end in intervals:
            day = end.astimezone(zone).date()
            durations[day] = durations.get(day, 0) + (end - start).total_seconds()
            if cluster_end is not None and start < cluster_end:
                invalid.update(cluster_days | {day})
                cluster_days.add(day)
                cluster_end = max(cluster_end, end)
            else:
                cluster_end, cluster_days = end, {day}
        for day, seconds in durations.items():
            if day not in invalid and 0 < seconds <= 90_000:
                rows[day]["sleep"] = round(seconds / 60)
        connection = db.get(HealthConnection, user.id)
        for record in device_days(db, user, first, last) if connection and connection.enabled else []:
            row = rows[record["day"]]
            row["steps"] = record["steps"]
            if record["day"] not in durations and record["sleep_seconds"] is not None:
                row["sleep"] = round(record["sleep_seconds"] / 60)
        for day, count, minutes in group_by_day(db, Workout, user, first, last, func.count(), func.sum(Workout.minutes)):
            rows[day].update(workouts=count, workout_minutes=minutes)
    if "finance" in modules:
        for day, currency, amount in db.execute(select(Transaction.day, Transaction.currency, func.sum(Transaction.amount))
            .where(Transaction.user_id == user.id, Transaction.deleted_at.is_(None), Transaction.kind == "expense",
                   Transaction.day.between(first, last)).group_by(Transaction.day, Transaction.currency)):
            rows[day]["expenses"][currency] = str(amount)
    if "books" in modules:
        for day, average in group_by_day(db, DiaryEntry, user, first, last, func.avg(DiaryEntry.mood)):
            rows[day]["mood"] = round(float(average), 1) if average is not None else None
        for day, pages in db.execute(select(ReadingDelta.day, func.sum(ReadingDelta.pages)).join(Book, Book.id == ReadingDelta.book_id)
            .where(ReadingDelta.user_id == user.id, Book.user_id == user.id, Book.deleted_at.is_(None),
                   ReadingDelta.day.between(first, last)).group_by(ReadingDelta.day)):
            rows[day]["pages"] = pages
        for day, count in db.execute(select(Book.finished_on, func.count()).where(Book.user_id == user.id,
            Book.deleted_at.is_(None), Book.status == "read", Book.finished_on.between(first, last)).group_by(Book.finished_on)):
            rows[day]["books"] = count
    return list(rows.values())


def observed(rows, key):
    return [row[key] for row in rows if row[key] is not None]


def ratio(rows, value, total):
    denominator = sum(observed(rows, total))
    return min(100, round(100 * sum(observed(rows, value)) / denominator)) if denominator else None


def totals(rows, currency):
    amounts = [Decimal(row["expenses"][currency]) for row in rows if currency in row["expenses"]]
    result = {}
    for key in ("tasks", "workouts", "pages", "books"):
        values = observed(rows, key)
        result[key] = max(0, sum(values)) if values else None
    for key in ("sleep", "mood"):
        values = observed(rows, key)
        result[key] = round(mean(values), 1) if values else None
    result["habits"] = ratio(rows, "habit_done", "habit_total")
    result["expenses"] = str(sum(amounts)) if amounts else None
    result["task_score"] = ratio(rows, "tasks", "task_total")
    return result


def score(totals):
    values = {**totals, "tasks": totals["task_score"]}
    if values["sleep"] is not None:
        values["sleep"] = min(100, values["sleep"] * 100 / 420)
    if values["mood"] is not None:
        values["mood"] = values["mood"] * 20
    available = {key: weight for key, weight in WEIGHTS.items() if values[key] is not None}
    return round(sum(values[key] * weight for key, weight in available.items()) / sum(available.values())) if available else None


def budget_tip(db, user, day, currency):
    if not EntitlementService.is_pro(user) or "finance" not in eligible(user):
        return None
    month = day.strftime("%Y-%m")
    expenses = dict(db.execute(select(Transaction.category, func.sum(Transaction.amount)).where(
        Transaction.user_id == user.id, Transaction.deleted_at.is_(None), Transaction.kind == "expense",
        Transaction.currency == currency, Transaction.day.between(day.replace(day=1), day)).group_by(Transaction.category)).all())
    candidates = [(round(100 * expenses.get(row.category, 0) / row.amount), row)
                  for row in db.scalars(select(Budget).where(Budget.user_id == user.id, Budget.deleted_at.is_(None),
                     Budget.currency == currency, Budget.month == month)).all() if row.amount > 0]
    percent, budget = max(candidates, default=(0, None), key=lambda pair: pair[0])
    return {"category": budget.category, "percent": percent, "spent": str(expenses[budget.category]),
            "amount": str(budget.amount), "month": month} if budget and percent >= 80 else None


def report(rows, previous, start, end, budget=None):
    currencies = sorted({code for row in rows + previous for code in row["expenses"]})
    currency = "PLN" if not currencies or "PLN" in currencies else currencies[0]
    current, prior = totals(rows, currency), totals(previous, currency)
    ranked = [(score(totals([row], currency)), row) for row in rows]
    ranked = [(value, row) for value, row in ranked if value is not None]
    best = max(ranked, key=lambda item: item[0])[1] if ranked else None
    hardest = min(ranked, key=lambda item: item[0])[1] if len(ranked) > 1 else None
    if hardest == best:
        hardest = None
    return {
        "start": start.isoformat(), "end": end.isoformat(), "currency": currency,
        "totals": current, "previous": prior, "score": score(current), "previous_score": score(prior),
        "days": rows, "best_day": best, "hard_day": hardest, "budget": budget,
        "has_data": any(current[key] is not None for key in (*FACTS, "books")),
    }


def links(rows, modules, currency):
    series = {}
    for key, (module, label, unit) in METRICS.items():
        if module not in modules:
            continue
        values = {}
        for row in rows:
            value = row["expenses"].get(currency) if key == "expenses" else row["workout_minutes"] if key == "workouts" else row[key]
            if value is not None:
                values[row["day"]] = Decimal(str(value)) / 60 if key == "sleep" else Decimal(str(value))
        series[key] = {"key": key, "module": module, "label": label,
                       "unit": currency if key == "expenses" else unit, "values": values}
    found, collecting = [], []
    for x, y in PAIRS:
        if x not in series or y not in series:
            continue
        left, right = series[x], series[y]
        common = len(set(left["values"]) & set(right["values"]))
        key = x + ":" + y
        matched = compare(left, right, reverse=False)
        if matched and matched["lower_average"] != matched["upper_average"]:
            found.append({**matched, "id": key})
        else:
            collecting.append({"id": key, "x": x, "y": y, "n_days": common, "needed": max(0, 8 - common)})
    return found, collecting
