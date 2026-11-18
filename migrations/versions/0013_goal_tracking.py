"""Measured goals and explicit habit contributions."""
from alembic import op
import sqlalchemy as sa
revision = "0013_goal_tracking"
down_revision = "0012_assistant_preferences"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("goals", sa.Column("target_value", sa.Numeric(14, 4), nullable=True))
    op.add_column("goals", sa.Column("current_value", sa.Numeric(14, 4), nullable=False, server_default="0"))
    op.add_column("goals", sa.Column("unit", sa.String(40), nullable=False, server_default=""))
    op.add_column("habits", sa.Column("contributes", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("habits", "contributes")
    op.drop_column("goals", "unit")
    op.drop_column("goals", "current_value")
    op.drop_column("goals", "target_value")
