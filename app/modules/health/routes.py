from datetime import date, timedelta, datetime, time
from uuid import UUID
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.errors import AppError
from app.core.owned import owned, record, require_module
from app.core.resource_api import add_resource
from app.modules.auth.dependencies import get_current_user
from app.modules.planning.dependencies import EntitlementService
from app.modules.health.models import (SleepEntry, WeightEntry, Workout, NutritionEntry, Medication, MedicationIntake,
                                       WorkoutProgram, WeightTarget, NutritionTarget)
from app.modules.health.schemas import (
    SleepInput,
    WeightInput,
    WorkoutInput,
    NutritionInput,
    MedicationInput,
    IntakeInput,
    ProgramInput,
    WeightTargetInput,
    NutritionTargetInput,
)

router = APIRouter(prefix="/api/v1/health", tags=["health tracking"])


def member(user=Depends(get_current_user)):
    return require_module(user, "health")


def today(user):
    return utcnow().astimezone(ZoneInfo(user.timezone)).date()


def history_filter(model):
    def check(user, item):
        if EntitlementService.is_pro(user):
            return True
        cutoff = today(user) - timedelta(days=29)
        if model is SleepEntry:
            cutoff = datetime.combine(cutoff, time.min, ZoneInfo(user.timezone))
            return (item.end_at >= cutoff) if item else model.end_at >= cutoff
        return (item.day >= cutoff) if item else model.day >= cutoff

    return check


def valid_history(user, values):
    day = values.get("day")
    if day is None and values.get("end_at"):
        day = values["end_at"].astimezone(ZoneInfo(user.timezone)).date()
    if day and day < today(user) - timedelta(days=29):
        EntitlementService.require_pro(user)


def no_future(db, user, values, item):
    valid_history(user, values)
    if values.get("day", today(user)) > today(user):
        raise AppError(422, "invalid_date", "Future tracking entries are not allowed")
    if values.get("end_at", utcnow()) > utcnow():
        raise AppError(422, "invalid_date", "Sleep must end in the past")


def workout_validate(db, user, values, item):
    valid_history(user, values)
    if values["day"] > today(user):
        EntitlementService.require_pro(user)
    program_id = values["program_id"]
    if program_id is not None and (item is None or item.program_id != program_id):
        EntitlementService.require_pro(user)
        owned(db, WorkoutProgram, user, program_id)


def observe_workout(db, user, item, previous):
    if item.day == today(user):
        from app.modules.dashboard.day_progress import observe_day
        observe_day(db, user)


@router.get("/summary")
def summary(from_: date = Query(alias="from"), to: date = Query(), user=Depends(member), db=Depends(get_db)):
    if to < from_ or (to - from_).days > 366:
        raise AppError(422, "invalid_range", "Use at most one year")
    if not EntitlementService.is_pro(user) and from_ < today(user) - timedelta(days=29):
        raise AppError(403, "pro_required", "Older history requires Pro")
    result = {}
    for model, key in [(WeightEntry, "weight"), (Workout, "workouts"), (NutritionEntry, "nutrition")]:
        if model is NutritionEntry and not EntitlementService.is_pro(user):
            continue
        items = db.scalars(
            select(model)
            .where(model.user_id == user.id, model.deleted_at.is_(None), model.day >= from_, model.day <= to)
            .order_by(model.day)
            .limit(5000)
        ).all()
        result[key] = [record(i) for i in items]
    from datetime import datetime, time

    zone = ZoneInfo(user.timezone)
    start = datetime.combine(from_, time.min, zone)
    end = datetime.combine(to + timedelta(days=1), time.min, zone)
    result["sleep"] = [
        {**record(s), "hours": round((s.end_at - s.start_at).total_seconds() / 3600, 2)}
        for s in db.scalars(
            select(SleepEntry)
            .where(
                SleepEntry.user_id == user.id,
                SleepEntry.deleted_at.is_(None),
                SleepEntry.end_at >= start,
                SleepEntry.end_at < end,
            )
            .order_by(SleepEntry.end_at)
            .limit(5000)
        )
    ]
    from app.modules.health.device_routes import device_days
    result["device_days"] = device_days(db, user, from_, to)
    return result


@router.post("/medications/{medication_id}/intakes")
def intake(medication_id: UUID, body: IntakeInput, user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    item = owned(db, Medication, user, medication_id, body.version)
    if body.day > today(user) or body.time not in item.times or not item.scheduled(body.day):
        raise AppError(422, "invalid_intake", "Invalid intake date or time")
    old = db.scalar(
        select(MedicationIntake).where(
            MedicationIntake.medication_id == item.id,
            MedicationIntake.day == body.day,
            MedicationIntake.time == body.time,
        )
    )
    if body.taken or body.skipped:
        taken_at = utcnow() if body.taken else None
        if old:
            if old.deleted_at is not None or old.skipped != body.skipped:
                old.taken_at = taken_at
            old.deleted_at = None
            old.skipped = body.skipped
        else:
            db.add(MedicationIntake(user_id=user.id, medication_id=item.id, day=body.day, time=body.time,
                                   skipped=body.skipped, taken_at=taken_at))
    elif old:
        old.deleted_at = utcnow()
    item.updated_at = utcnow()
    db.commit()
    return record(item)


@router.get("/medications/{medication_id}/intakes")
def intakes(medication_id: UUID, day: date, user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    owned(db, Medication, user, medication_id)
    return {
        "items": [
            record(i)
            for i in db.scalars(
                select(MedicationIntake).where(
                    MedicationIntake.user_id == user.id,
                    MedicationIntake.medication_id == medication_id,
                    MedicationIntake.day == day,
                    MedicationIntake.deleted_at.is_(None),
                    MedicationIntake.skipped.is_(False),
                )
            )
        ]
    }


@router.get("/medication-schedule")
def medication_schedule(day: date, user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    medications = db.scalars(
        select(Medication).where(Medication.user_id == user.id, Medication.deleted_at.is_(None))
        .order_by(Medication.title, Medication.id)
    )
    marked = {(entry.medication_id, entry.time): entry for entry in db.scalars(
        select(MedicationIntake).where(
            MedicationIntake.user_id == user.id,
            MedicationIntake.deleted_at.is_(None),
            MedicationIntake.day == day,
        )
    )}
    slots = [
        {"row": {"id": medication.id, "title": medication.title, "version": medication.version, "dosage": medication.dosage},
         "time": slot, "taken": entry is not None and not entry.skipped, "skipped": entry is not None and entry.skipped,
         "taken_at": (entry.taken_at or entry.created_at) if entry and not entry.skipped else None}
        for medication in medications if medication.scheduled(day) for slot in medication.times
        for entry in [marked.get((medication.id, slot))]
    ]
    return {"items": sorted(slots, key=lambda item: item["time"])}


@router.get("/medication-tracking")
def medication_tracking(user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    day = today(user)
    first = day - timedelta(days=13)
    zone = ZoneInfo(user.timezone)
    now = utcnow().astimezone(zone).strftime("%H:%M")
    courses = db.scalars(select(Medication).where(Medication.user_id == user.id, Medication.deleted_at.is_(None))
                         .order_by(Medication.created_at.desc(), Medication.id)).all()
    intakes = db.scalars(select(MedicationIntake).where(MedicationIntake.user_id == user.id,
        MedicationIntake.day >= first, MedicationIntake.day <= day, MedicationIntake.deleted_at.is_(None))).all()
    marked = {(entry.medication_id, entry.day, entry.time): entry for entry in intakes}
    regularity = []
    for offset in range(14):
        date = first + timedelta(days=offset)
        slots = [(item.id, date, slot) for item in courses if item.scheduled(date)
                 and item.created_at.astimezone(zone).date() <= date for slot in item.times
                 if date < day or slot <= now or (item.id, date, slot) in marked]
        taken = sum(key in marked and not marked[key].skipped for key in slots)
        regularity.append({"day": date, "taken": taken, "total": len(slots)})
    counts = dict(db.execute(select(MedicationIntake.medication_id, func.count()).join(Medication)
        .where(MedicationIntake.user_id == user.id, MedicationIntake.deleted_at.is_(None), MedicationIntake.skipped.is_(False),
               func.coalesce(MedicationIntake.taken_at, MedicationIntake.created_at) >= Medication.stock_since)
        .group_by(MedicationIntake.medication_id)).all())
    return {"courses": [{**record(item), "remaining": max(0, item.stock - counts.get(item.id, 0))
            if item.stock is not None else None} for item in courses], "days": regularity}


@router.get("/nutrition-summary")
def nutrition_summary(day: date, user=Depends(member), db=Depends(get_db)):
    EntitlementService.require_pro(user)
    result = {"day": day}
    for key in ("calories", "protein", "fat", "carbs"):
        result[key] = str(
            db.scalar(
                select(func.coalesce(func.sum(getattr(NutritionEntry, key)), 0)).where(
                    NutritionEntry.user_id == user.id, NutritionEntry.deleted_at.is_(None), NutritionEntry.day == day
                )
            )
        )
    return result


def update_stock(db, user, item, previous):
    if previous is None or previous["stock"] != item.stock:
        item.stock_since = utcnow() if item.stock is not None else None


for path, model, schema, paid, validator, preserved, written in [
    ("/sleep", SleepEntry, SleepInput, False, no_future, (), None),
    ("/weight", WeightEntry, WeightInput, False, no_future, ("notes",), None),
    ("/workouts", Workout, WorkoutInput, False, workout_validate, ("efforts", "program_id"), observe_workout),
    ("/nutrition", NutritionEntry, NutritionInput, True, no_future, (), None),
    ("/medications", Medication, MedicationInput, True, None, ("weekdays", "course_end", "stock"), update_stock),
]:
    add_resource(
        router,
        path,
        model,
        schema,
        "health",
        pro_only=paid,
        validate=validator,
        read_filter=history_filter(model) if not paid else None,
        preserve_omitted=preserved,
        after_write=written,
    )

def one_target(model):
    def validate(db, user, values, item):
        if item is None and db.scalar(select(model.id).where(model.user_id == user.id, model.deleted_at.is_(None))):
            raise AppError(409, "duplicate", "Edit the existing target")
    return validate


add_resource(router, "/programs", WorkoutProgram, ProgramInput, "health", pro_only=True)
add_resource(router, "/weight-targets", WeightTarget, WeightTargetInput, "health", pro_only=True, validate=one_target(WeightTarget),
             preserve_omitted=("mode",))
add_resource(router, "/nutrition-targets", NutritionTarget, NutritionTargetInput, "health", pro_only=True,
             validate=one_target(NutritionTarget))
