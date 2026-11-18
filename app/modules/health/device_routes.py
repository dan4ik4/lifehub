"""Read-only device health import. Values are daily snapshots, never increments."""
from datetime import date, timedelta
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, delete

from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.errors import AppError
from app.core.owned import lock_user
from app.modules.health.routes import member
from app.modules.auth.dependencies import get_current_user
from app.modules.health.models import HealthConnection, HealthDaily

router = APIRouter(prefix="/api/v1/health/device", tags=["device health"])
Provider = Literal["apple_health", "health_connect"]
Metric = Literal["steps", "sleep"]


class ConnectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider
    consent: Literal[True]


class DayInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: date
    steps: int | None = Field(default=None, ge=0, le=200000)
    sleep_seconds: int | None = Field(default=None, ge=0, le=90000)


class SnapshotInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider
    sync_token: UUID
    revision: int = Field(ge=0)
    timezone: str = Field(min_length=1, max_length=100)
    metrics: list[Metric] = Field(min_length=1, max_length=2)
    days: list[DayInput] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def unique_days(self):
        if len({d.day for d in self.days}) != len(self.days) or len(set(self.metrics)) != len(self.metrics):
            raise ValueError("Duplicate days or metrics")
        return self


def status(item):
    return {"provider": item.provider, "enabled": item.enabled, "revision": item.revision,
            "last_synced_at": item.last_synced_at} if item else None


def device_days(db, user, start, end):
    connection = db.get(HealthConnection, user.id)
    if not connection:
        return []
    rows = db.scalars(select(HealthDaily).where(
        HealthDaily.user_id == user.id, HealthDaily.provider == connection.provider,
        HealthDaily.timezone == user.timezone, HealthDaily.day >= start, HealthDaily.day <= end,
    ).order_by(HealthDaily.day)).all()
    return [{"day": r.day, "steps": r.steps, "sleep_seconds": r.sleep_seconds,
             "provider": r.provider, "updated_at": r.updated_at} for r in rows]


@router.get("")
def get_status(user=Depends(member), db=Depends(get_db)):
    day = utcnow().astimezone(ZoneInfo(user.timezone)).date()
    return {"connection": status(db.get(HealthConnection, user.id)),
            "days": device_days(db, user, day - timedelta(days=6), day)}


@router.post("/connect")
def connect(body: ConnectInput, request: Request, user=Depends(member), db=Depends(get_db)):
    request.app.state.rate_limiter.hit("health-connect:" + str(user.id), 20, 3600)
    lock_user(db, user)
    item = db.get(HealthConnection, user.id)
    if not item:
        item = HealthConnection(user_id=user.id, provider=body.provider, revision=0)
        db.add(item)
    else:
        item.revision += 1
    item.provider, item.enabled, item.sync_token = body.provider, True, uuid4()
    item.last_synced_at = None
    db.commit()
    return {**status(item), "sync_token": item.sync_token}


@router.post("/sync")
def sync(body: SnapshotInput, request: Request, user=Depends(member), db=Depends(get_db)):
    request.app.state.rate_limiter.hit("health-sync:" + str(user.id), 60, 3600)
    lock_user(db, user)
    connection = db.get(HealthConnection, user.id)
    if not connection or not connection.enabled or connection.sync_token != body.sync_token or connection.provider != body.provider:
        raise AppError(409, "health_disconnected", "Подключите здоровье на этом устройстве заново.")
    if connection.revision != body.revision:
        raise AppError(409, "version_conflict", "Синхронизация устарела. Повторите чтение данных.")
    if body.timezone != user.timezone:
        raise AppError(409, "health_timezone", "Часовой пояс изменился. Повторите синхронизацию.")
    now = utcnow()
    day = now.astimezone(ZoneInfo(user.timezone)).date()
    if any(d.day > day or d.day < day - timedelta(days=29) for d in body.days):
        raise AppError(422, "invalid_range", "Синхронизация доступна за последние 30 дней.")
    for value in body.days:
        row = db.get(HealthDaily, (user.id, body.provider, value.day))
        if not row:
            row = HealthDaily(user_id=user.id, provider=body.provider, day=value.day)
            db.add(row)
        if row.timezone and row.timezone != body.timezone:
            row.steps, row.sleep_seconds = None, None
        row.timezone, row.updated_at = body.timezone, now
        if "steps" in body.metrics:
            row.steps = value.steps
        if "sleep" in body.metrics:
            row.sleep_seconds = value.sleep_seconds
    connection.revision += 1
    connection.last_synced_at = now
    db.commit()
    return status(connection)


@router.delete("")
def disconnect(erase: bool = False, user=Depends(get_current_user), db=Depends(get_db)):
    lock_user(db, user)
    connection = db.get(HealthConnection, user.id)
    if connection:
        connection.enabled = False
        connection.sync_token = uuid4()
        connection.revision += 1
    if erase:
        db.execute(delete(HealthDaily).where(HealthDaily.user_id == user.id))
    db.commit()
    return {"connection": status(connection)}
