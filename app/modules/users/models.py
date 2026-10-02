from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import ForeignKey, LargeBinary, String, Uuid, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, UTCDateTime, utcnow


class Avatar(Base):
    __tablename__ = "user_avatars"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    image: Mapped[bytes] = mapped_column(LargeBinary)


class DataExport(Base):
    __tablename__ = "user_exports"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    format: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(12), default="queued", index=True)
    encrypted_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)

    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    notification_attempts: Mapped[int] = mapped_column(Integer, default=0)
    notification_retry_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
