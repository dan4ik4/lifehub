"""Small owner-scoped photo previews in chat history."""
from alembic import op
import sqlalchemy as sa
revision = "0010_chat_photos"
down_revision = "0009_chat_history"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("planning_commands", sa.Column("request_photos", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("planning_commands", "request_photos")
