from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import get_db
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.auth.schemas import UserAuthResponse
from app.modules.users.schemas import UserPatchRequest
from app.modules.users.service import UserService, user_response

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get("/me", response_model=UserAuthResponse)
def me(user: User = Depends(get_current_user)):
    return user_response(user)


@router.patch("/me", response_model=UserAuthResponse)
def patch_me(payload: UserPatchRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return UserService(db).patch(user, payload)
