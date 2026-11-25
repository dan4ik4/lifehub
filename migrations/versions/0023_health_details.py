"""Health records, nutrition targets, and course schedules."""
from alembic import op
import sqlalchemy as sa
from app.core.database import UTCDateTime

revision = "0023_health_details"
down_revision = "0022_pdf_batches"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("health_weight", sa.Column("notes", sa.Text(), nullable=False, server_default=""))
    op.add_column("health_weight_targets", sa.Column("mode", sa.String(8), nullable=False, server_default="maintain"))
    op.add_column("health_workouts", sa.Column("program_id", sa.Uuid(), nullable=True))
    op.add_column("health_medications", sa.Column("weekdays", sa.JSON(), nullable=False, server_default="[0,1,2,3,4,5,6]"))
    op.add_column("health_medications", sa.Column("course_end", sa.Date(), nullable=True))
    op.add_column("health_medications", sa.Column("stock", sa.Integer(), nullable=True))
    op.add_column("health_medications", sa.Column("stock_since", UTCDateTime(), nullable=True))
    op.add_column("health_medication_intakes", sa.Column("skipped", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("health_medication_intakes", sa.Column("taken_at", UTCDateTime(), nullable=True))
    op.create_table("health_nutrition_targets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.Column("deleted_at", UTCDateTime(), nullable=True),
        *(sa.Column(key, sa.Integer(), nullable=False) for key in ("calories", "protein", "fat", "carbs")))
    op.create_index("ix_health_nutrition_targets_user_id", "health_nutrition_targets", ["user_id"])
    op.create_index("ix_health_nutrition_targets_deleted_at", "health_nutrition_targets", ["deleted_at"])


def downgrade():
    op.drop_table("health_nutrition_targets")
    for name in ("skipped", "taken_at"):
        op.drop_column("health_medication_intakes", name)
    for name in ("weekdays", "course_end", "stock", "stock_since"):
        op.drop_column("health_medications", name)
    op.drop_column("health_workouts", "program_id")
    op.drop_column("health_weight_targets", "mode")
    op.drop_column("health_weight", "notes")
