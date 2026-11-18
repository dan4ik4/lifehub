"""One source-bound AI selection per owner/month/currency."""
from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import ForeignKey, JSON, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, UTCDateTime, utcnow


class FinanceReview(Base):
    __tablename__ = 'finance_reviews'
    __table_args__ = (UniqueConstraint('user_id', 'month', 'currency'),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    month: Mapped[str] = mapped_column(String(7))
    currency: Mapped[str] = mapped_column(String(3))
    source_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default='processing')
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
