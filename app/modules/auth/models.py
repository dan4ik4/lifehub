from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, UTCDateTime, utcnow


class User(Base):
    __tablename__ = "users"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), default="")
    email: Mapped[str] = mapped_column(String(320), index=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    plan: Mapped[str] = mapped_column(String(10), default="free")
    trial_ends: Mapped[datetime | None] = mapped_column(UTCDateTime)
    trial_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    free_modules: Mapped[list[str]] = mapped_column(JSON, default=list)
    timezone: Mapped[str] = mapped_column(String(100), default="UTC")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    identities: Mapped[list["AuthIdentity"]] = relationship(back_populates="user", lazy="selectin", cascade="all, delete-orphan")
    __table_args__ = (
        Index("uq_users_password_email", "email", unique=True,
              postgresql_where=text("password_hash IS NOT NULL"), sqlite_where=text("password_hash IS NOT NULL")),
    )


class AuthIdentity(Base):
    __tablename__ = "auth_identities"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(12))
    provider_subject: Mapped[str] = mapped_column(String(255))
    user: Mapped[User] = relationship(back_populates="identities")
    __table_args__ = (UniqueConstraint("provider", "provider_subject", name="uq_identity_provider_subject"),)


class PendingRegistration(Base):
    __tablename__ = "pending_registrations"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(50), default="")
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    otp_hash: Mapped[str] = mapped_column(String(64))
    otp_expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    resend_count: Mapped[int] = mapped_column(Integer, default=0)
    last_sent_at: Mapped[datetime] = mapped_column(UTCDateTime)
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    family_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    replaced_by_id: Mapped[UUID | None] = mapped_column(Uuid)
    device_info: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    token_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_sent_at: Mapped[datetime] = mapped_column(UTCDateTime)


class EmailChangeChallenge(Base):
    __tablename__ = "email_change_challenges"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    new_email: Mapped[str] = mapped_column(String(320))
    otp_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    registration_expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    resend_count: Mapped[int] = mapped_column(Integer, default=0)
    last_sent_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    email: Mapped[str] = mapped_column(String(320), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    blocked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
