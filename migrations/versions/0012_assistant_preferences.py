"""Persistent assistant consent per account."""
from alembic import op
import sqlalchemy as sa
revision = "0012_assistant_preferences"
down_revision = "0011_device_health"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("users", sa.Column("chat_preferences", sa.JSON(), nullable=False, server_default="{}"))

def downgrade():
    op.drop_column("users", "chat_preferences")
