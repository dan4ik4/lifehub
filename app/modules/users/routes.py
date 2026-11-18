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


from app.modules.auth.schemas import RequestModel


class AssistantPreferences(RequestModel):
    messages: bool = False
    media: bool = False
    modules: bool = False


@router.get("/me/assistant-preferences", response_model=AssistantPreferences)
def assistant_preferences(user: User = Depends(get_current_user)):
    return user.chat_preferences or {}


@router.patch("/me/assistant-preferences", response_model=AssistantPreferences)
def save_assistant_preferences(payload: AssistantPreferences, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from sqlalchemy import select
    user = db.scalar(select(User).where(User.id == user.id).with_for_update())
    user.chat_preferences = payload.model_dump()
    db.commit()
    return user.chat_preferences
