from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import ForeignKey, String, Text, Uuid, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, UTCDateTime, utcnow


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint_hash: Mapped[str] = mapped_column(String(64), unique=True)
    encrypted_subscription: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ProductNotice(Base):
    __tablename__ = "product_notices"
    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    module: Mapped[str] = mapped_column(String(32))
    pro_only: Mapped[bool] = mapped_column(Boolean, default=False)
    url: Mapped[str] = mapped_column(String(100))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    retry_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
