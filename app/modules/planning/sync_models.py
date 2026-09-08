"""Persistent calendar mappings, OAuth challenges and leased sync phases."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, UTCDateTime, utcnow


class CalendarConnection(Base):
    __tablename__ = "calendar_connections"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_calendar_user_provider"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    calendar_id: Mapped[str] = mapped_column(String(1024), default="primary")
    account_label: Mapped[str] = mapped_column(String(320))
    encrypted_credentials: Mapped[str | None] = mapped_column(Text, nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    active_job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    next_sync_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ExternalEventLink(Base):
    __tablename__ = "external_event_links"
    __table_args__ = (
        UniqueConstraint("connection_id", "external_id", name="uq_calendar_external_event"),
        UniqueConstraint("connection_id", "event_id", name="uq_calendar_local_event"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_connections.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_events.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(1024))
    etag: Mapped[str | None] = mapped_column(String(512), nullable=True)
    synced_version: Mapped[int] = mapped_column(Integer, default=0)
    fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remote_exists: Mapped[bool] = mapped_column(Boolean, default=False)


class CalendarSyncCursor(Base):
    __tablename__ = "calendar_sync_cursors"
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_connections.id", ondelete="CASCADE"), primary_key=True)
    cursor: Mapped[str | None] = mapped_column(Text, nullable=True)


class CalendarOAuthState(Base):
    __tablename__ = "calendar_oauth_states"
    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    redirect_uri: Mapped[str] = mapped_column(String(2048))
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    encrypted_verifier: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class CalendarSyncJobRecord(Base):
    __tablename__ = "calendar_sync_jobs"
    __table_args__ = (Index("ix_calendar_jobs_due", "status", "available_at"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_connections.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")
    phase: Mapped[str] = mapped_column(String(24), default="push")
    accepted_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    available_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    push_completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    lease_owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AppleOutboundChange(Base):
    __tablename__ = "apple_outbound_changes"
    __table_args__ = (UniqueConstraint("connection_id", "event_id", "event_version", name="uq_apple_outbound_version"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_connections.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_sync_jobs.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_events.id", ondelete="CASCADE"))
    event_version: Mapped[int] = mapped_column(Integer)
    operation: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict] = mapped_column(JSON)
    fingerprint: Mapped[str] = mapped_column(String(64))
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AppleInboundBatch(Base):
    __tablename__ = "apple_inbound_batches"
    __table_args__ = (UniqueConstraint("connection_id", "batch_id", name="uq_apple_inbound_batch"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_connections.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_sync_jobs.id", ondelete="CASCADE"), index=True)
    batch_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    payload: Mapped[list] = mapped_column(JSON)
    cursor: Mapped[str | None] = mapped_column(Text, nullable=True)
    final: Mapped[bool] = mapped_column(Boolean, default=True)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
