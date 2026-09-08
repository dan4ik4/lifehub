from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime, utcnow


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text)
    start_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    due_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)
    timezone: Mapped[str] = mapped_column(String(100), default="UTC")
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    priority: Mapped[str] = mapped_column(String(10), default="none")
    rrule: Mapped[str | None] = mapped_column(String(2000))
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)
    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (CheckConstraint("priority IN ('none','low','medium','high')", name="ck_task_priority"),)


class TaskOccurrence(Base):
    __tablename__ = "task_occurrences"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    occurrence_at: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(15), default="pending")
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    __table_args__ = (UniqueConstraint("task_id", "occurrence_at", name="uq_task_occurrence"),)


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text)
    start_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    end_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    timezone: Mapped[str] = mapped_column(String(100), default="UTC")
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    rrule: Mapped[str | None] = mapped_column(String(2000))
    source: Mapped[str] = mapped_column(String(12), default="local")
    connection_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    external_read_only: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)
    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (CheckConstraint("end_at > start_at", name="ck_event_positive_duration"),)


class EventException(Base):
    __tablename__ = "event_exceptions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_events.id", ondelete="CASCADE"), index=True)
    occurrence_at: Mapped[datetime] = mapped_column(UTCDateTime)
    kind: Mapped[str] = mapped_column(String(20), default="cancelled")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("event_id", "occurrence_at", name="uq_event_exception"),)


class PlanningList(Base):
    __tablename__ = "planning_lists"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(12), default="custom")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    # NULL allows many custom lists, "shopping" allows exactly one system list.
    system_key: Mapped[str | None] = mapped_column(String(20))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (UniqueConstraint("user_id", "system_key", name="uq_planning_system_list"),)


class ListItem(Base):
    __tablename__ = "list_items"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    list_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("planning_lists.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    unit: Mapped[str | None] = mapped_column(String(40))
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    __mapper_args__ = {"version_id_col": version}


class Reminder(Base):
    __tablename__ = "planning_reminders"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(10))
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    trigger_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    offset_minutes: Mapped[int | None] = mapped_column(Integer)
    channel: Mapped[str] = mapped_column(String(10), default="push")
    next_trigger_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)
    occurrence_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    delivered_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    delivery_key: Mapped[str] = mapped_column(String(100), default=lambda: str(uuid.uuid4()))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(String(100))
    next_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    lease_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    lease_token: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    cancelled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_reminder_due", "next_trigger_at", "cancelled_at"),)
