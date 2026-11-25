"""Weekly, cross-module and archived Results views."""
from datetime import date, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.errors import AppError
from app.core.owned import lock_user
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.dashboard.results_data import FACTS, PAIR_IDS, budget_tip, collect, eligible, links, report
from app.modules.dashboard.results_models import ReadingDelta, ResultsPreferences, ResultsSnapshot
from app.modules.planning.dependencies import EntitlementService
from app.modules.planning.schemas import InputModel

router = APIRouter(prefix="/api/v1/insights", tags=["results"])
Module = Literal["planning", "goals_habits", "health", "finance", "books"]


def account_day(user, now=None):
    return (now or utcnow()).astimezone(ZoneInfo(user.timezone))


def monday(day):
    return day - timedelta(days=day.weekday())


def latest_week(local):
    active = monday(local.date())
    return active if local.weekday() == 6 and local.hour >= 20 else active - timedelta(days=7)


def results_ai(db, user):
    preferences = db.get(ResultsPreferences, user.id)
    return bool(preferences and preferences.ai_enabled and EntitlementService.is_pro(user))


def record_reading(db, user, book, previous):
    if previous is not None and (delta := book.current_page - previous["current_page"]):
        db.add(ReadingDelta(user_id=user.id, book_id=book.id, day=account_day(user).date(), pages=delta))


def snapshot(db, user, kind, start):
    item = db.get(ResultsSnapshot, (user.id, kind, start))
    return item if item and set(item.payload.get("modules", [])) == eligible(user) else None


def prepare_week(db, user, start):
    end = start + timedelta(days=6)
    rows = collect(db, user, start - timedelta(days=7), end)
    payload = report(rows[7:], rows[:7], start, end)
    payload.update(modules=sorted(eligible(user)), budget=budget_tip(db, user, end, payload["currency"]))
    return payload


def prepare_month(db, user, start, end):
    payload = report(collect(db, user, start, end), [], start, end)
    payload["modules"] = sorted(eligible(user))
    return payload


def facts(payload):
    return [key for key in ("habits", "sleep", "expenses", "tasks", "workouts", "pages", "mood")
            if payload["totals"][key] is not None]


def published(payload, stored=None, ai=False):
    selected = stored.ai_selection if stored and ai else None
    suggestion_modules = (("health", "habits", "sleep"), ("finance", "budget", "finance"), ("planning", "planning", "planning"))
    kpis = ("tasks", "habits", "sleep", "workouts", "expenses", "pages")
    return {
        **payload,
        "kpi": [{"key": key, "value": payload["totals"][key], "previous": payload["previous"][key]} for key in kpis],
        "built_at": stored.built_at if stored else None,
        "summary": selected or facts(payload)[:3],
        "ai_used": bool(selected),
        "suggestions": [key for module, key, alternate in suggestion_modules
                        if module in payload["modules"] or alternate in payload["modules"]],
    }


def archive_entry(payload, selection=None):
    return {key: payload[key] for key in ("start", "end", "currency", "score", "totals", "days")} | {
        "summary": selection or facts(payload)[:3],
    }


@router.get("/week")
def week(start: date | None = None, user=Depends(get_current_user), db=Depends(get_db)):
    local = account_day(user)
    latest = latest_week(local)
    start = start or latest
    if start < date(1900, 1, 15) or start > latest or start.weekday() != 0:
        raise AppError(422, "invalid_period", "Выберите понедельник завершённой недели.")
    stored = snapshot(db, user, "week", start)
    payload = stored.payload if stored else prepare_week(db, user, start)
    ai = results_ai(db, user)
    recent = []
    for offset in range(3):
        day = latest - timedelta(weeks=offset)
        row = snapshot(db, user, "week", day)
        habits = row.payload["totals"]["habits"] if row else None
        if day == start:
            habits = payload["totals"]["habits"]
        elif day == start - timedelta(weeks=1):
            habits = payload["previous"]["habits"]
        recent.append({"start": day, "habits": habits})
    return published(payload, stored, ai) | {"latest": latest, "recent": recent}


@router.get("/pairs")
def pairs(days: int = Query(default=28, ge=14, le=28), modules: list[Module] | None = Query(default=None, max_length=5),
          currency: str = Query(default="PLN", pattern=r"^[A-Z]{3}$"), user=Depends(get_current_user), db=Depends(get_db)):
    if days not in (14, 28):
        raise AppError(422, "invalid_period", "Выберите период 14 или 28 дней.")
    local = account_day(user)
    day = local.date() - timedelta(days=local.hour < 8)
    saved = snapshot(db, user, "pairs", day)
    rows = saved.payload["days"] if saved else collect(db, user, day - timedelta(days=28), day - timedelta(days=1), planned=False)
    enabled = eligible(user)
    selected = enabled if modules is None else set(modules) & enabled
    found, collecting = links(rows[-days:], selected, currency)
    prior = snapshot(db, user, "pairs", day - timedelta(days=1))
    prior_pairs = {row["id"] for row in links(prior.payload["days"][-days:], selected, currency)[0]} if prior else set()
    settings = db.get(ResultsPreferences, user.id)
    hidden = set(settings.hidden_pairs if settings else [])
    return {"day": day, "updated_at": saved.built_at if saved else None,
            "days": [row["day"] for row in rows[-days:]], "available_modules": sorted(enabled), "collecting": collecting,
            "found": [dict(row, new=row["id"] not in prior_pairs) for row in found if row["id"] not in hidden],
            "hidden": [row["id"] for row in found if row["id"] in hidden]}


@router.get("/archive")
def archive(year: int | None = Query(default=None, ge=1900, le=9998), kind: Literal["week", "month"] = "week",
            user=Depends(get_current_user), db=Depends(get_db)):
    local = account_day(user)
    today = local.date()
    year = year or today.year
    if year > today.year:
        raise AppError(422, "invalid_period", "Выберите прошедший год или текущий год.")
    first, last = date(year, 1, 1), date(year, 12, 31)
    rows = db.scalars(select(ResultsSnapshot).where(ResultsSnapshot.user_id == user.id,
        ResultsSnapshot.kind.in_(("week", "month")), ResultsSnapshot.start <= today)
        .order_by(ResultsSnapshot.start.desc())).all()
    modules = eligible(user)
    rows = [row for row in rows if set(row.payload.get("modules", [])) == modules and row.payload["has_data"]]
    weeks = {row.start: row for row in rows if row.kind == "week"}
    months = {row.start: row for row in rows if row.kind == "month"}
    ai = results_ai(db, user)
    latest = latest_week(local)
    history = {}
    # Reconstruct the recent history on initial use; older snapshots stay as originally published.
    if kind == "week" and year in ((latest + timedelta(days=6)).year, (latest - timedelta(days=36)).year):
        missing = [latest - timedelta(weeks=offset) for offset in range(7)
                   if latest - timedelta(weeks=offset) not in weeks]
        if missing:
            start = min(missing)
            days = collect(db, user, start, latest + timedelta(days=6))
            for week_start in missing:
                offset = (week_start - start).days
                payload = report(days[offset:offset + 7], [], week_start, week_start + timedelta(days=6))
                if payload["has_data"]:
                    history[week_start] = archive_entry(payload)
    history.update({day: archive_entry(row.payload, row.ai_selection if ai else None) for day, row in weeks.items()})
    current_month = today.replace(day=1)
    featured = None
    if year == today.year:
        featured = archive_entry(prepare_month(db, user, current_month, today))
    elif (month := next((row for day, row in months.items() if day.year == year), None)):
        featured = archive_entry(month.payload)
    use = history if kind == "week" else {day: archive_entry(row.payload) for day, row in months.items()}
    if kind == "month" and featured and year == today.year and any(
        featured["totals"][key] is not None for key in (*FACTS, "books")
    ):
        use[current_month] = featured
    items = [item for day, item in sorted(use.items(), reverse=True)
             if first <= (day + timedelta(days=6) if kind == "week" else day) <= last]
    trend = [item for day, item in sorted(history.items()) if day <= latest and item["score"] is not None][-7:]
    years = sorted({today.year, year, *((day + timedelta(days=6)).year for day in history),
                    *(day.year for day in months)}, reverse=True)
    return {"items": items, "featured": featured, "trend": trend, "year": year, "years": years,
            "latest": latest, "current_month": current_month}


class Consent(InputModel):
    ai_enabled: bool


class HiddenPair(InputModel):
    pair: str
    hidden: bool


@router.get("/preferences")
def preferences(user=Depends(get_current_user), db=Depends(get_db)):
    row = db.get(ResultsPreferences, user.id)
    return {"ai_enabled": bool(row and row.ai_enabled), "decided": bool(row and row.decided)}


@router.patch("/preferences")
def put_preferences(body: Consent, user=Depends(get_current_user), db=Depends(get_db)):
    lock_user(db, user)
    if body.ai_enabled:
        EntitlementService.require_pro(user)
    row = db.get(ResultsPreferences, user.id)
    if not row:
        row = ResultsPreferences(user_id=user.id)
        db.add(row)
    row.ai_enabled = body.ai_enabled
    row.decided = True
    db.commit()
    return {"ai_enabled": row.ai_enabled, "decided": True}


@router.patch("/pairs/visibility")
def visibility(body: HiddenPair, user=Depends(get_current_user), db=Depends(get_db)):
    if body.pair not in PAIR_IDS:
        raise AppError(422, "invalid_scope", "Неизвестная пара показателей.")
    lock_user(db, user)
    row = db.get(ResultsPreferences, user.id)
    if not row:
        row = ResultsPreferences(user_id=user.id, ai_enabled=False, hidden_pairs=[])
        db.add(row)
    hidden = set(row.hidden_pairs)
    if body.hidden:
        hidden.add(body.pair)
    else:
        hidden.discard(body.pair)
    row.hidden_pairs = sorted(hidden)
    db.commit()
    return {"hidden": row.hidden_pairs}
