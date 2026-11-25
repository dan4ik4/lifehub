"""Publish weekly and daily Results on each account's local calendar."""
import json
import logging
from datetime import timedelta

from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from app.core.database import utcnow
from app.modules.auth.models import User
from app.modules.dashboard.results import account_day, facts, latest_week, prepare_month, prepare_week, results_ai, snapshot
from app.modules.dashboard.results_data import collect, eligible
from app.modules.dashboard.results_models import ResultsSnapshot
from app.modules.notifications.models import PushSubscription
from app.modules.planning.command_models import PlanningAiUsage
from app.workers.jobs.product_notifications import enqueue

log = logging.getLogger(__name__)


class WeeklySelection(BaseModel):
    facts: list[str] = Field(min_length=1, max_length=3)


def select_facts(settings, payload):
    from openai import OpenAI

    supplied = {key: payload["totals"][key] for key in facts(payload)}
    with OpenAI(api_key=settings.openai_api_key, timeout=8, max_retries=0) as client:
        response = client.responses.parse(
            model=settings.openai_model, store=False, max_output_tokens=600, text_format=WeeklySelection,
            input=[
                {"role": "system", "content": "Select up to three supplied keys for a private weekly recap. Return only the keys. Do not write claims, advice or a diagnosis."},
                {"role": "user", "content": json.dumps(supplied)},
            ],
        )
    selection = response.output_parsed
    if selection and len(selection.facts) == len(set(selection.facts)) and set(selection.facts) <= supplied.keys():
        return selection.facts
    return None


def publish(db, user, kind, start, payload, now):
    item = db.get(ResultsSnapshot, (user.id, kind, start))
    if item is None:
        item = ResultsSnapshot(user_id=user.id, kind=kind, start=start)
        db.add(item)
    item.payload = payload
    item.built_at = now
    item.ai_attempted = False
    item.ai_selection = None
    db.flush()
    return item


def present(db, user, settings, now, allow_ai):
    local = account_day(user, now)
    today = local.date()
    week_start = latest_week(local)
    slot = today - timedelta(days=local.hour < 8)
    month_end = today.replace(day=1) - timedelta(days=1)
    month_start = month_end.replace(day=1)

    week = snapshot(db, user, "week", week_start)
    if not week:
        week = publish(db, user, "week", week_start, prepare_week(db, user, week_start), now)
    if not snapshot(db, user, "pairs", slot):
        days = collect(db, user, slot - timedelta(days=28), slot - timedelta(days=1), planned=False)
        publish(db, user, "pairs", slot, {"days": days, "modules": sorted(eligible(user))}, now)
        db.execute(delete(ResultsSnapshot).where(ResultsSnapshot.user_id == user.id,
            ResultsSnapshot.kind == "pairs", ResultsSnapshot.start < slot - timedelta(days=2)))
    if not snapshot(db, user, "month", month_start):
        publish(db, user, "month", month_start, prepare_month(db, user, month_start, month_end), now)
    if local.weekday() == 6 and local.hour >= 20 and week.payload["has_data"] and db.scalar(
        select(PushSubscription.id).where(PushSubscription.user_id == user.id).limit(1)
    ):
        enqueue(db, user, f"results:{user.id}:{week_start}", "insights",
                f"/modules/insights?start={week_start}", now + timedelta(hours=4), now)

    use_ai = (allow_ai and settings.openai_api_key and not week.ai_attempted
              and week.payload["has_data"] and facts(week.payload) and results_ai(db, user))
    ai_work = None
    if use_ai:
        usage = db.get(PlanningAiUsage, (user.id, now.date()))
        if usage is None:
            usage = PlanningAiUsage(user_id=user.id, day=now.date(), count=0)
            db.add(usage)
        if usage.count < 50:
            usage.count += 1
            week.ai_attempted = True
            ai_work = (user.id, week_start, week.built_at, week.payload)
    db.commit()
    return ai_work


def run_results(db, settings, now=None):
    now = now or utcnow()
    users = db.scalars(select(User.id).where(User.deleted_at.is_(None), User.email_verified.is_(True),
                                          User.onboarding_completed.is_(True))).all()
    selected = None
    for user_id in users:
        try:
            user = db.scalar(select(User).where(User.id == user_id, User.deleted_at.is_(None))
                             .with_for_update(skip_locked=True).execution_options(populate_existing=True))
            if user:
                pending = present(db, user, settings, now, allow_ai=selected is None)
                if pending:
                    selected = pending
        except Exception:
            db.rollback()
            log.warning("Results publication deferred for one account")
    if selected:
        uid, start, built_at, payload = selected
        try:
            selection = select_facts(settings, payload)
            if selection:
                owner = db.scalar(select(User).where(User.id == uid, User.deleted_at.is_(None))
                                  .with_for_update().execution_options(populate_existing=True))
                row = snapshot(db, owner, "week", start) if owner and results_ai(db, owner) else None
                if row and row.built_at == built_at:
                    row.ai_selection = selection
                db.commit()
        except Exception:
            db.rollback()
            log.warning("Weekly Results retained their calculated summary")
