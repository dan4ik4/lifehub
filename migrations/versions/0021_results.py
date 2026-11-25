"""Add dated results snapshots, consent and reading history."""

from alembic import op
import sqlalchemy as sa

revision = "0021_results"
down_revision = "0020_dashboard_closed_days"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "results_snapshots",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.String(8), primary_key=True),
        sa.Column("start", sa.Date(), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("built_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ai_attempted", sa.Boolean(), nullable=False),
        sa.Column("ai_selection", sa.JSON(), nullable=True),
    )
    op.create_table(
        "results_preferences",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("ai_enabled", sa.Boolean(), nullable=False),
        sa.Column("decided", sa.Boolean(), nullable=False),
        sa.Column("hidden_pairs", sa.JSON(), nullable=False),
    )
    op.create_table(
        "reading_deltas",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("book_id", sa.Uuid(), sa.ForeignKey("books.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("pages", sa.Integer(), nullable=False),
    )
    op.create_index("ix_reading_deltas_user_day", "reading_deltas", ["user_id", "day"])


def downgrade():
    op.drop_table("reading_deltas")
    op.drop_table("results_preferences")
    op.drop_table("results_snapshots")
