from datetime import date
from decimal import Decimal
from uuid import UUID
from sqlalchemy import Boolean, Date, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.owned import OwnedRecord


class Goal(OwnedRecord, Base):
    __tablename__ = "goals"
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), default="active")
    progress: Mapped[int] = mapped_column(Integer, default=0)


class Milestone(OwnedRecord, Base):
    __tablename__ = "goal_milestones"
    goal_id: Mapped[UUID] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    progress: Mapped[int] = mapped_column(Integer, default=0)


class Habit(OwnedRecord, Base):
    __tablename__ = "habits"
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(16), default="boolean")
    target: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=1)
    unit: Mapped[str] = mapped_column(String(40), default="")
    weekdays: Mapped[list[int]] = mapped_column(JSON, default=lambda: list(range(7)))
    reminder_time: Mapped[str | None] = mapped_column(String(5))
    goal_id: Mapped[UUID | None] = mapped_column(ForeignKey("goals.id", ondelete="SET NULL"), index=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class HabitCheckin(OwnedRecord, Base):
    __tablename__ = "habit_checkins"
    habit_id: Mapped[UUID] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    value: Mapped[Decimal] = mapped_column(Numeric(14, 4))
    __table_args__ = (UniqueConstraint("habit_id", "day", name="uq_habit_checkin_day"),)


class GoalTaskLink(Base):
    __tablename__ = "goal_task_links"
    goal_id: Mapped[UUID] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), primary_key=True)
    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
