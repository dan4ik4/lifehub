from fastapi import Depends

from app.core.database import utcnow
from app.core.errors import AppError
from app.modules.auth.dependencies import get_current_user


class EntitlementService:
    @staticmethod
    def is_pro(user) -> bool:
        return user.plan == "pro" or (user.plan == "trial" and user.trial_ends is not None and user.trial_ends > utcnow())

    @staticmethod
    def require_pro(user):
        if not EntitlementService.is_pro(user):
            raise AppError(403, "pro_required", "This feature requires Pro or an active trial")
        return user

    @staticmethod
    def require_planning(user):
        if not EntitlementService.is_pro(user) and "planning" not in (user.free_modules or []):
            raise AppError(403, "module_locked", "Planning is not selected among your Free modules")
        return user


require_pro = EntitlementService.require_pro


def require_planning_user(user=Depends(get_current_user)):
    return EntitlementService.require_planning(user)


PlanningAccess = EntitlementService
