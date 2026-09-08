from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import Date, ForeignKey, Integer, JSON, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime, utcnow


class PlanningAiUsage(Base):
    __tablename__ = 'planning_ai_usage'
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey('users.id'), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


class PlanningCommandRecord(Base):
    __tablename__ = 'planning_commands'
    __table_args__ = (UniqueConstraint('user_id', 'idempotency_key'),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey('users.id'), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default='processing')
    response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
