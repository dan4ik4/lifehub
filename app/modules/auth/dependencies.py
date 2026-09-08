from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.core.errors import AppError
from app.modules.auth.models import User
from app.modules.auth.tokens import TokenService


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    authorization = request.headers.get("Authorization", "")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise AppError(401, "unauthorized", "Authentication is required", headers={"WWW-Authenticate": "Bearer"})
    claims = TokenService(db, request.app.state.settings).decode(parts[1], "access")
    user = db.get(User, UUID(claims["sub"]))
    if not user or user.deleted_at is not None or not user.email_verified:
        raise AppError(401, "unauthorized", "Account is unavailable")
    return user
