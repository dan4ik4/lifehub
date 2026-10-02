from datetime import date, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select, func
from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.errors import AppError
from app.core.owned import lock_user, owned, record, require_module
from app.modules.auth.dependencies import get_current_user
from app.modules.planning.dependencies import EntitlementService
from app.modules.planning.models import Task
from app.modules.goals_habits.models import Goal, Habit, HabitCheckin, Milestone, GoalTaskLink
from app.modules.goals_habits.schemas import (
    GoalInput,
    GoalEdit,
    HabitInput,
    HabitEdit,
    CheckinInput,
    MilestoneInput,
    MilestoneEdit,
    TaskLinkInput,
)

router = APIRouter(prefix="/api/v1", tags=["goals and habits"])


def member(user=Depends(get_current_user)):
    return require_module(user, "goals_habits")


def pro(user):
    EntitlementService.require_pro(user)


def today(user):
    return utcnow().astimezone(ZoneInfo(user.timezone)).date()


def check_quota(db, user, model, exclude=None):
    lock_user(db, user)
    if EntitlementService.is_pro(user):
        return
    query = select(func.count()).select_from(model).where(model.user_id == user.id, model.deleted_at.is_(None))
    query = query.where(Goal.status == "active") if model is Goal else query.where(Habit.archived.is_(False))
    if exclude:
        query = query.where(model.id != exclude)
    if db.scalar(query) >= (1 if model is Goal else 3):
        raise AppError(403, "pro_required", "Free limit reached")


def habit_data(db, user, item):
    result = record(item)
    checkin = db.scalar(select(HabitCheckin).where(HabitCheckin.habit_id == item.id, HabitCheckin.day == today(user)))
    result["today_value"] = checkin.value if checkin else 0
    result["today_complete"] = bool(checkin and checkin.value >= item.target)
    return result


@router.get("/goals")
def goals(
    user=Depends(member), db=Depends(get_db), offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)
):
    items = db.scalars(
        select(Goal)
        .where(Goal.user_id == user.id, Goal.deleted_at.is_(None))
        .order_by(Goal.created_at.desc(), Goal.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    return {"items": [record(g) for g in items[:limit]], "has_more": len(items) > limit}


@router.post("/goals", status_code=201)
def create_goal(body: GoalInput, user=Depends(member), db=Depends(get_db)):
    if body.status == "active":
        check_quota(db, user, Goal)
    values = body.model_dump()
    if body.status == "completed":
        values["progress"] = 100
    item = Goal(user_id=user.id, **values)
    db.add(item)
    db.commit()
    return record(item)


@router.patch("/goals/{goal_id}")
def edit_goal(goal_id: UUID, body: GoalEdit, user=Depends(member), db=Depends(get_db)):
    lock_user(db, user)
    item = owned(db, Goal, user, goal_id, body.version)
    if body.status == "active":
        check_quota(db, user, Goal, item.id)
    for k, v in body.model_dump(exclude={"version"}).items():
        setattr(item, k, v)
    if item.status == "completed":
        item.progress = 100
    db.commit()
    return record(item)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: UUID, version: int = Query(ge=1), user=Depends(member), db=Depends(get_db)):
    item = owned(db, Goal, user, goal_id, version)
    item.deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.get("/goals/{goal_id}")
def goal_detail(goal_id: UUID, user=Depends(member), db=Depends(get_db)):
    item = owned(db, Goal, user, goal_id)
    result = record(item)
    result["milestones"] = (
        [
            record(m)
            for m in db.scalars(select(Milestone).where(Milestone.goal_id == goal_id, Milestone.deleted_at.is_(None)))
        ]
        if EntitlementService.is_pro(user)
        else []
    )
    result["habits"] = [
        habit_data(db, user, h)
        for h in db.scalars(
            select(Habit).where(Habit.user_id == user.id, Habit.goal_id == goal_id, Habit.deleted_at.is_(None))
        )
    ]
    result["tasks"] = (
        [
            {"id": t.id, "title": t.title, "completed": t.completed_at is not None}
            for t in db.scalars(
                select(Task)
                .join(GoalTaskLink, Task.id == GoalTaskLink.task_id)
                .where(GoalTaskLink.goal_id == goal_id, Task.user_id == user.id, Task.deleted_at.is_(None))
            )
        ]
        if EntitlementService.is_pro(user)
        else []
    )
    return result


@router.post("/goals/{goal_id}/milestones", status_code=201)
def add_milestone(goal_id: UUID, body: MilestoneInput, user=Depends(member), db=Depends(get_db)):
    pro(user)
    owned(db, Goal, user, goal_id)
    if (
        db.scalar(
            select(func.count())
            .select_from(Milestone)
            .where(Milestone.goal_id == goal_id, Milestone.deleted_at.is_(None))
        )
        >= 100
    ):
        raise AppError(422, "limit_reached", "Maximum 100 milestones per goal")
    item = Milestone(user_id=user.id, goal_id=goal_id, **body.model_dump())
    db.add(item)
    db.commit()
    return record(item)


@router.patch("/goals/{goal_id}/milestones/{milestone_id}")
def edit_milestone(goal_id: UUID, milestone_id: UUID, body: MilestoneEdit, user=Depends(member), db=Depends(get_db)):
    pro(user)
    owned(db, Goal, user, goal_id)
    item = owned(db, Milestone, user, milestone_id, body.version)
    if item.goal_id != goal_id:
        raise AppError(404, "not_found", "Milestone not found")
    item.title, item.progress = body.title, body.progress
    db.commit()
    return record(item)


@router.delete("/goals/{goal_id}/milestones/{milestone_id}", status_code=204)
def delete_milestone(
    goal_id: UUID, milestone_id: UUID, version: int = Query(ge=1), user=Depends(member), db=Depends(get_db)
):
    pro(user)
    owned(db, Goal, user, goal_id)
    item = owned(db, Milestone, user, milestone_id, version)
    if item.goal_id != goal_id:
        raise AppError(404, "not_found", "Milestone not found")
    item.deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.post("/goals/{goal_id}/tasks", status_code=201)
def link_task(goal_id: UUID, body: TaskLinkInput, user=Depends(member), db=Depends(get_db)):
    pro(user)
    owned(db, Goal, user, goal_id)
    owned(db, Task, user, body.task_id)
    if db.get(GoalTaskLink, (goal_id, body.task_id)) is None:
        db.add(GoalTaskLink(goal_id=goal_id, task_id=body.task_id))
        db.commit()
    return {"task_id": body.task_id}


@router.delete("/goals/{goal_id}/tasks/{task_id}", status_code=204)
def unlink_task(goal_id: UUID, task_id: UUID, user=Depends(member), db=Depends(get_db)):
    pro(user)
    owned(db, Goal, user, goal_id)
    link = db.get(GoalTaskLink, (goal_id, task_id))
    if link:
        db.delete(link)
        db.commit()
    return Response(status_code=204)


@router.get("/habits")
def habits(
    user=Depends(member), db=Depends(get_db), offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)
):
    items = db.scalars(
        select(Habit)
        .where(Habit.user_id == user.id, Habit.deleted_at.is_(None))
        .order_by(Habit.created_at, Habit.id)
        .offset(offset)
        .limit(limit + 1)
    ).all()
    return {
        "items": [habit_data(db, user, h) for h in items[:limit]],
        "has_more": len(items) > limit,
        "today": today(user),
    }


def validate_habit(db, user, body):
    values = body.model_dump(exclude={"version"})
    if body.kind == "boolean":
        values["target"] = 1
    if body.goal_id:
        pro(user)
        owned(db, Goal, user, body.goal_id)
    return values


@router.post("/habits", status_code=201)
def create_habit(body: HabitInput, user=Depends(member), db=Depends(get_db)):
    if not body.archived:
        check_quota(db, user, Habit)
    item = Habit(user_id=user.id, **validate_habit(db, user, body))
    db.add(item)
    db.commit()
    return habit_data(db, user, item)


@router.patch("/habits/{habit_id}")
def edit_habit(habit_id: UUID, body: HabitEdit, user=Depends(member), db=Depends(get_db)):
    lock_user(db, user)
    item = owned(db, Habit, user, habit_id, body.version)
    if not body.archived:
        check_quota(db, user, Habit, item.id)
    for k, v in validate_habit(db, user, body).items():
        setattr(item, k, v)
    db.commit()
    return habit_data(db, user, item)


@router.delete("/habits/{habit_id}", status_code=204)
def delete_habit(habit_id: UUID, version: int = Query(ge=1), user=Depends(member), db=Depends(get_db)):
    item = owned(db, Habit, user, habit_id, version)
    item.deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.post("/habits/{habit_id}/checkins")
def checkin(habit_id: UUID, body: CheckinInput, user=Depends(member), db=Depends(get_db)):
    habit = owned(db, Habit, user, habit_id, body.version)
    if habit.archived:
        raise AppError(409, "habit_archived", "Restore the habit before checking in")
    if body.day > today(user) or body.day < habit.created_at.astimezone(ZoneInfo(user.timezone)).date():
        raise AppError(422, "invalid_date", "Date is outside the habit lifetime")
    if not EntitlementService.is_pro(user) and body.day < today(user) - timedelta(days=29):
        raise AppError(403, "pro_required", "Older history requires Pro")
    if body.day.weekday() not in habit.weekdays:
        raise AppError(422, "unscheduled_day", "Habit is not scheduled on this weekday")
    if habit.kind == "boolean" and body.value not in (0, 1):
        raise AppError(422, "invalid_value", "Use zero or one for a yes/no habit")
    item = db.scalar(select(HabitCheckin).where(HabitCheckin.habit_id == habit.id, HabitCheckin.day == body.day))
    if item:
        item.value = body.value
    else:
        db.add(HabitCheckin(user_id=user.id, habit_id=habit.id, day=body.day, value=body.value))
    habit.updated_at = utcnow()
    db.commit()
    return habit_data(db, user, habit)


@router.get("/habits/{habit_id}/checkins")
def checkins(
    habit_id: UUID, from_: date = Query(alias="from"), to: date = Query(), user=Depends(member), db=Depends(get_db)
):
    habit = owned(db, Habit, user, habit_id)
    if to < from_ or (to - from_).days > 366:
        raise AppError(422, "invalid_range", "Use at most one year")
    if not EntitlementService.is_pro(user) and from_ < today(user) - timedelta(days=29):
        raise AppError(403, "pro_required", "Older history requires Pro")
    items = db.scalars(
        select(HabitCheckin)
        .where(HabitCheckin.habit_id == habit.id, HabitCheckin.day >= from_, HabitCheckin.day <= to)
        .order_by(HabitCheckin.day)
    ).all()
    start = max(from_, habit.created_at.astimezone(ZoneInfo(user.timezone)).date())
    scheduled = sum(
        (start + timedelta(days=i)).weekday() in habit.weekdays
        for i in range(max(0, (min(to, today(user)) - start).days + 1))
    )
    complete = sum(x.value >= habit.target and x.day.weekday() in habit.weekdays for x in items)
    return {
        "items": [record(x) for x in items],
        "completed_days": complete,
        "scheduled_days": scheduled,
        "completion_percent": round(100 * complete / scheduled) if scheduled else 0,
    }
