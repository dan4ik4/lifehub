"""Allowlisted product operations using the same validation as HTTP endpoints."""
import json
from typing import Literal
from uuid import UUID
from pydantic import Field
from sqlalchemy import select
from fastapi.encoders import jsonable_encoder
from app.core.errors import AppError
from app.core.owned import owned, record, require_module
from app.modules.planning.schemas import InputModel
from app.modules.planning.dependencies import EntitlementService

class ModuleAction(InputModel):
    type: Literal["module_record"]
    resource: str = Field(max_length=80)
    operation: Literal["create", "update", "delete", "duplicate", "checkin", "pay", "intake"]
    record_id: UUID | None = None
    version: int | None = Field(default=None, ge=1)
    # Explicit JSON object validated by the resource's ordinary input schema.
    values_json: str = Field(default="{}", max_length=30000)

class AtomicSession:
    """Endpoint commits become flushes; only the command service owns the commit."""
    def __init__(self, db):
        self.db = db
    def commit(self):
        self.db.flush()
    def __getattr__(self, name):
        return getattr(self.db, name)

def registry():
    from app.core.resource_api import RESOURCE_REGISTRY
    from app.modules.goals_habits import routes as gh
    from app.modules.goals_habits.models import Goal, Habit
    from app.modules.goals_habits.schemas import GoalInput, GoalEdit, HabitInput, HabitEdit
    result = dict(RESOURCE_REGISTRY)
    for key, model, schema, edit_schema, create, edit, remove in [
        ("goals_habits/goals", Goal, GoalInput, GoalEdit, gh.create_goal, gh.edit_goal, gh.delete_goal),
        ("goals_habits/habits", Habit, HabitInput, HabitEdit, gh.create_habit, gh.edit_habit, gh.delete_habit),
    ]:
        result[key] = dict(model=model, schema=schema, edit_schema=edit_schema, module="goals_habits",
                           create=create, edit=edit, remove=remove)
    return result

def access(user, spec):
    require_module(user, spec["module"])
    if spec.get("pro_only"):
        EntitlementService.require_pro(user)

def execute_module(db, user, action):
    if not (user.chat_preferences or {}).get("modules"):
        raise AppError(403, "module_consent_required", "Включите доступ помощника к модулям в настройках.")
    spec = registry().get(action.resource)
    if spec is None:
        raise AppError(422, "unknown_resource", "Unsupported module resource")
    access(user, spec)
    values = json.loads(action.values_json)
    if not isinstance(values, dict):
        raise AppError(422, "validation_error", "Expected an object")
    session = AtomicSession(db)
    item = None
    if action.operation != "create":
        if not action.record_id or action.version is None:
            raise AppError(422, "validation_error", "Record ID and version are required")
        item = owned(db, spec["model"], user, action.record_id, action.version)
        if spec.get("read_filter") and not spec["read_filter"](user, item):
            raise AppError(403, "pro_required", "Older history requires Pro")
    if action.operation == "delete":
        spec["remove"](item.id, action.version, user, session)
        return item.id
    if action.operation == "pay":
        if action.resource != "finance/debts":
            raise AppError(422, "validation_error", "Payments require a debt")
        from app.modules.finance.routes import pay
        from app.modules.finance.schemas import PaymentInput
        result = pay(item.id, PaymentInput.model_validate({**values, "version": action.version}), user, session)
        return UUID(str(result["payment"]["id"]))
    if action.operation == "intake":
        if action.resource != "health/medications":
            raise AppError(422, "validation_error", "Intakes require a medication")
        from app.modules.health.routes import intake
        from app.modules.health.schemas import IntakeInput
        intake(item.id, IntakeInput.model_validate({**values, "version": action.version}), user, session)
        return item.id
    if action.operation == "checkin":
        if action.resource != "goals_habits/habits":
            raise AppError(422, "validation_error", "Only habits support checkin")
        from app.modules.goals_habits.routes import checkin
        from app.modules.goals_habits.schemas import CheckinInput
        checkin(item.id, CheckinInput.model_validate({**values, "version": action.version}), user, session)
        return item.id
    if item is not None:
        original = {key: getattr(item, key) for key in spec["schema"].model_fields}
        values = {**original, **values}
    if action.operation in ("create", "duplicate"):
        result = spec["create"](spec["schema"].model_validate(values), user, session)
    else:
        result = spec["edit"](item.id, spec["edit_schema"].model_validate({**values, "version": action.version}), user, session)
    return UUID(str(result["id"]))

def module_context(db, user):
    result = {}
    for key, spec in registry().items():
        try:
            access(user, spec)
        except AppError:
            continue
        model = spec["model"]
        query = select(model).where(model.user_id == user.id, model.deleted_at.is_(None))
        if spec.get("read_filter"):
            query = query.where(spec["read_filter"](user, None))
        rows = db.scalars(query.order_by(model.updated_at.desc()).limit(31)).all()
        if key == "goals_habits/goals":
            from app.modules.goals_habits.routes import goal_data
            spec = {**spec, "output": lambda item, owner: goal_data(db, owner, item)}
        result[key] = {"records": jsonable_encoder([spec.get("output", lambda item, user: record(item))(r, user) for r in rows[:30]]), "truncated": len(rows)>30,
                       "input_schema": spec["schema"].model_json_schema()}
    return result
