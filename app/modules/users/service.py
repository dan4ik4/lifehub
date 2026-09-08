from datetime import timedelta

from sqlalchemy import select

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.auth.models import User
from app.modules.auth.schemas import UserAuthResponse
from app.modules.users.schemas import valid_free_modules


def user_response(user: User) -> UserAuthResponse:
    providers = sorted({identity.provider for identity in user.identities} | ({"password"} if user.password_hash else set()))
    effective_plan = "free" if user.plan == "trial" and (not user.trial_ends or user.trial_ends <= utcnow()) else user.plan
    return UserAuthResponse(id=user.id, name=user.name, email=user.email, email_verified=user.email_verified,
        auth_providers=providers, plan=effective_plan, trial_ends=user.trial_ends,
        onboarding_completed=user.onboarding_completed, free_modules=user.free_modules, timezone=user.timezone)


class UserService:
    def __init__(self, db):
        self.db = db

    def patch(self, user, payload):
        user = self.db.scalar(select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True))
        data = payload.model_dump(exclude_unset=True)
        modules = data.pop("free_modules", None)
        if modules is not None:
            if user.free_modules and set(user.free_modules) != set(modules):
                raise AppError(409, "immutable_free_modules", "Free module selection cannot be changed")
            user.free_modules = modules
        requested_plan = data.pop("plan", None)
        if requested_plan is not None:
            if user.plan == "pro":
                raise AppError(409, "plan_managed_by_billing", "The paid plan is managed by billing")
            if requested_plan == "trial":
                if user.trial_started_at is not None:
                    if user.plan != "trial" or not user.trial_ends or user.trial_ends <= utcnow():
                        raise AppError(409, "trial_already_used", "The trial can be activated only once")
                else:
                    user.trial_started_at = utcnow()
                    user.trial_ends = user.trial_started_at + timedelta(hours=72)
                user.plan = "trial"
            else:
                user.plan = "free"
        completed = data.get("onboarding_completed")
        if completed is False and user.onboarding_completed:
            raise AppError(409, "onboarding_already_completed", "Completed onboarding cannot be reset")
        if completed is True and not valid_free_modules(user.free_modules):
            raise AppError(422, "validation_error", "Select Planning or three unique legacy modules before completing onboarding")
        for key, value in data.items():
            setattr(user, key, value)
        self.db.commit()
        return user_response(user)
