"""Persist the first completion of all three daily rings."""
from alembic import op
import sqlalchemy as sa

revision = "0020_dashboard_closed_days"
down_revision = "0019_journal_workouts"
branch_labels = depends_on = None


def upgrade():
    op.create_table("dashboard_closed_days",
                    sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("day", sa.Date(), primary_key=True))


def downgrade():
    op.drop_table("dashboard_closed_days")
