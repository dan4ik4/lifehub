from fastapi import APIRouter

from app.modules.auth.routes import router as auth_router
from app.modules.users.routes import router as users_router
from app.modules.planning.routes import router as planning_router
from app.modules.planning.sync_routes import router as sync_router
from app.modules.planning.commands import router as command_router

from app.modules.notifications.routes import router as notification_router

from app.modules.goals_habits.routes import router as goals_router

from app.modules.health.routes import router as health_router
from app.modules.finance.routes import router as finance_router
from app.modules.books.routes import router as books_router

from app.modules.dashboard.routes import router as dashboard_router

from app.modules.users.privacy import router as privacy_router

router = APIRouter()
for module in (
    auth_router,
    users_router,
    planning_router,
    sync_router,
    command_router,
    notification_router,
    goals_router,
    health_router,
    finance_router,
    books_router,
    dashboard_router,
    privacy_router,
):
    router.include_router(module)
