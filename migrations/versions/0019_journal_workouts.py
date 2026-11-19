"""Persist journal mood and workout efforts."""
from alembic import op
import sqlalchemy as sa

revision = "0019_journal_workouts"
down_revision = "0018_cross_reviews"
branch_labels = depends_on = None


def upgrade():
    op.add_column("health_workouts", sa.Column("efforts", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("diary_entries", sa.Column("mood", sa.Integer(), nullable=True))
    op.add_column("diary_entries", sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"))


def downgrade():
    op.drop_column("diary_entries", "tags")
    op.drop_column("diary_entries", "mood")
    op.drop_column("health_workouts", "efforts")
