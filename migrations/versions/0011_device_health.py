"""Owner-scoped daily snapshots from mobile health stores."""
from alembic import op
import sqlalchemy as sa
revision = "0011_device_health"
down_revision = "0010_chat_photos"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("health_connections",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("sync_token", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table("health_device_days",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("provider", sa.String(20), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("timezone", sa.String(100), nullable=False),
        sa.Column("steps", sa.Integer(), nullable=True),
        sa.Column("sleep_seconds", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("health_device_days")
    op.drop_table("health_connections")
