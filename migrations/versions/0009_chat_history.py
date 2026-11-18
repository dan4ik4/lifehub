"""Persist planning conversation alongside idempotent commands."""

from alembic import op
import sqlalchemy as sa

revision = "0009_chat_history"
down_revision = "0008_weight_unit"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("planning_commands", sa.Column("request_text", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("planning_commands", "request_text")
