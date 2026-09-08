from fastapi import APIRouter

from app.modules.auth.routes import router as auth_router
from app.modules.users.routes import router as users_router
from app.modules.planning.routes import router as planning_router
from app.modules.planning.sync_routes import router as sync_router
from app.modules.planning.commands import router as command_router

router = APIRouter()
for module in (auth_router, users_router, planning_router, sync_router, command_router):
    router.include_router(module)
