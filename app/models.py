"""Import all model modules for Alembic and isolated test schema creation."""

from app.modules.auth import models as auth_models
from app.modules.planning import models as planning_models
from app.modules.planning import sync_models
from app.modules.planning import command_models

__all__ = ["auth_models", "planning_models", "sync_models", "command_models"]

from app.modules.notifications import models as notification_models

from app.modules.goals_habits import models as goals_habits_models

from app.modules.health import models as health_models
from app.modules.finance import models as finance_models
from app.modules.books import models as books_models

from app.modules.users import models as user_models
