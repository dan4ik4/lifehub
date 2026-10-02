"""Owner-scoped primitives shared by the product modules."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4
from sqlalchemy import ForeignKey, Integer, Uuid, select
from sqlalchemy.orm import Mapped, mapped_column, declared_attr
from app.core.database import UTCDateTime, utcnow
from app.core.errors import AppError
from app.modules.planning.dependencies import EntitlementService


class OwnedRecord:
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, index=True)

    @declared_attr.directive
    def __mapper_args__(cls):
        return {"version_id_col": cls.version}


def require_module(user, module):
    if not EntitlementService.is_pro(user) and module not in (user.free_modules or []):
        raise AppError(403, "module_locked", "This module is not included in your Free selection")
    return user


def owned(db, model, user, item_id, version=None):
    item = db.scalar(
        select(model).where(model.id == item_id, model.user_id == user.id, model.deleted_at.is_(None)).with_for_update()
    )
    if item is None:
        raise AppError(404, "not_found", "Record not found")
    if version is not None and item.version != version:
        raise AppError(409, "version_conflict", "Record has changed; reload and try again")
    return item


def record(item):
    return {
        c.name: (str(getattr(item, c.name)) if isinstance(getattr(item, c.name), Decimal) else getattr(item, c.name))
        for c in item.__table__.columns
        if c.name not in {"user_id", "deleted_at"}
    }


def lock_user(db, user):
    from app.modules.auth.models import User

    db.scalar(select(User).where(User.id == user.id).with_for_update())
