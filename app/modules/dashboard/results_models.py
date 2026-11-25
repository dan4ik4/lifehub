from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, JSON, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime, utcnow


class ResultsSnapshot(Base):
    __tablename__ = "results_snapshots"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(8), primary_key=True)
    start: Mapped[date] = mapped_column(Date, primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    built_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ai_attempted: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_selection: Mapped[list[str] | None] = mapped_column(JSON)


class ResultsPreferences(Base):
    __tablename__ = "results_preferences"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    ai_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    decided: Mapped[bool] = mapped_column(Boolean, default=False)
    hidden_pairs: Mapped[list[str]] = mapped_column(JSON, default=list)


class ReadingDelta(Base):
    __tablename__ = "reading_deltas"
    __table_args__ = (Index("ix_reading_deltas_user_day", "user_id", "day"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    book_id: Mapped[UUID] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    pages: Mapped[int] = mapped_column(Integer)
