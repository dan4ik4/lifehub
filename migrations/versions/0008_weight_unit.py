"""Profile weight display unit; stored measurements remain kilograms."""

from alembic import op
import sqlalchemy as sa

revision = "0008_weight_unit"
down_revision = "0007_savings_history"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("weight_unit", sa.String(2), nullable=False, server_default="kg"))


def downgrade():
    op.drop_column("users", "weight_unit")
