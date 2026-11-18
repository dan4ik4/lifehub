"""Owner-scoped CSV/PDF previews and shared durable import fingerprints."""
from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import ForeignKey, JSON, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, UTCDateTime, utcnow


class CsvImport(Base):
    __tablename__ = 'finance_csv_imports'
    __table_args__ = (UniqueConstraint('user_id', 'request_key'),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    request_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    account: Mapped[str] = mapped_column(String(100))
    source_format: Mapped[str] = mapped_column(String(8), default='csv', server_default='csv')
    status: Mapped[str] = mapped_column(String(16), default='processing')
    rows: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class CsvImportRow(Base):
    __tablename__ = 'finance_csv_rows'
    user_id: Mapped[UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    account_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), primary_key=True)
    transaction_id: Mapped[UUID] = mapped_column(ForeignKey('finance_transactions.id', ondelete='CASCADE'))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
