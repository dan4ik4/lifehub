"""Typed CRUD registration with owner checks, bounded pagination and optimistic versions."""

from uuid import UUID
from datetime import date
from fastapi import Depends, Query, Response
from pydantic import create_model, Field
from sqlalchemy import select
from app.core.database import utcnow
from app.core.dependencies import get_db
from app.core.owned import owned, record, require_module, lock_user
from app.modules.auth.dependencies import get_current_user
from app.modules.planning.dependencies import EntitlementService


def add_resource(
    router,
    path,
    model,
    schema,
    module,
    *,
    pro_only=False,
    validate=None,
    read_filter=None,
    serialize=None,
    after_write=None,
):
    edit_schema = create_model(schema.__name__ + "Edit", __base__=schema, version=(int, Field(ge=1)))

    def member(user=Depends(get_current_user)):
        require_module(user, module)
        if pro_only:
            EntitlementService.require_pro(user)
        return user

    def output(item, user):
        return serialize(item, user) if serialize else record(item)

    def guard(item, user):
        if read_filter is not None:
            from app.core.errors import AppError

            if not read_filter(user, item):
                raise AppError(403, "pro_required", "Older history requires Pro")

    def listing(
        user=Depends(member),
        db=Depends(get_db),
        offset: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=100),
        day: date | None = None,
        status: str | None = Query(None, max_length=30),
    ):
        query = select(model).where(model.user_id == user.id, model.deleted_at.is_(None))
        if read_filter is not None:
            query = query.where(read_filter(user, None))
        if day is not None and hasattr(model, "day"):
            query = query.where(model.day == day)
        if status is not None and hasattr(model, "status"):
            query = query.where(model.status == status)
        items = db.scalars(query.order_by(model.created_at.desc(), model.id).offset(offset).limit(limit + 1)).all()
        return {"items": [output(i, user) for i in items[:limit]], "has_more": len(items) > limit}

    def create(body: schema, user=Depends(member), db=Depends(get_db)):
        lock_user(db, user)
        values = body.model_dump()
        if validate:
            validate(db, user, values, None)
        item = model(user_id=user.id, **values)
        db.add(item)
        if after_write:
            db.flush()
            after_write(db, user, item, None)
        db.commit()
        return output(item, user)

    def edit(item_id: UUID, body: edit_schema, user=Depends(member), db=Depends(get_db)):
        lock_user(db, user)
        item = owned(db, model, user, item_id, body.version)
        guard(item, user)
        previous = record(item)
        values = body.model_dump(exclude={"version"})
        if validate:
            validate(db, user, values, item)
        for key, value in values.items():
            setattr(item, key, value)
        if after_write:
            after_write(db, user, item, previous)
        db.commit()
        return output(item, user)

    def remove(item_id: UUID, version: int = Query(ge=1), user=Depends(member), db=Depends(get_db)):
        item = owned(db, model, user, item_id, version)
        item.deleted_at = utcnow()
        db.commit()
        return Response(status_code=204)

    def get(item_id: UUID, user=Depends(member), db=Depends(get_db)):
        item = owned(db, model, user, item_id)
        guard(item, user)
        return output(item, user)

    for endpoint, suffix, methods, status in [
        (listing, "", ["GET"], 200),
        (create, "", ["POST"], 201),
        (get, "/{item_id}", ["GET"], 200),
        (edit, "/{item_id}", ["PATCH"], 200),
        (remove, "/{item_id}", ["DELETE"], 204),
    ]:
        endpoint.__name__ = model.__tablename__ + "_" + endpoint.__name__
        router.add_api_route(path + suffix, endpoint, methods=methods, status_code=status)
