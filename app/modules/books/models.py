from datetime import date
from sqlalchemy import Date, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.core.owned import OwnedRecord


class Book(OwnedRecord, Base):
    __tablename__ = "books"
    title: Mapped[str] = mapped_column(String(300))
    author: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(10), default="want")
    total_pages: Mapped[int | None] = mapped_column(Integer)
    current_page: Mapped[int] = mapped_column(Integer, default=0)
    rating: Mapped[int | None] = mapped_column(Integer)
    genre: Mapped[str] = mapped_column(String(100), default="")
    cover_id: Mapped[int | None] = mapped_column(Integer)
    open_library_key: Mapped[str | None] = mapped_column(String(60))
    notes: Mapped[str] = mapped_column(Text, default="")
    started_on: Mapped[date | None] = mapped_column(Date)
    finished_on: Mapped[date | None] = mapped_column(Date)


class DiaryEntry(OwnedRecord, Base):
    __tablename__ = "diary_entries"
    day: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    text: Mapped[str] = mapped_column(Text)
