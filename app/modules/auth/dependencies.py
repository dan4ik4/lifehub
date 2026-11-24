from uuid import UUID

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.core.errors import AppError
from app.modules.auth.browser import browser_token
from app.modules.auth.models import User
from app.modules.auth.tokens import TokenService


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    authorization = request.headers.get("Authorization", "")
    parts = authorization.split()
    token = parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else None
    if not authorization:
        token = browser_token(request, refresh=False)
    if not token:
        raise AppError(401, "unauthorized", "Authentication is required", headers={"WWW-Authenticate": "Bearer"})
    claims = TokenService(db, request.app.state.settings).decode(token, "access")
    user = db.get(User, UUID(claims["sub"]))
    if not user or user.deleted_at is not None or not user.email_verified:
        raise AppError(401, "unauthorized", "Account is unavailable")
    return user
