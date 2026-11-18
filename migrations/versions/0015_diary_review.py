"""Cached, source-bound weekly diary reviews."""
from alembic import op
import sqlalchemy as sa
from app.core.database import UTCDateTime

revision = '0015_diary_review'
down_revision = '0014_csv_import'
branch_labels = depends_on = None


def upgrade():
    op.create_table('diary_weekly_reviews',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('end_day', sa.Date(), nullable=False),
        sa.Column('source_hash', sa.String(64), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('output', sa.JSON(), nullable=True),
        sa.Column('created_at', UTCDateTime(), nullable=False),
        sa.Column('updated_at', UTCDateTime(), nullable=False),
        sa.UniqueConstraint('user_id', 'end_day', 'source_hash'))
    op.create_index('ix_diary_weekly_reviews_user_id', 'diary_weekly_reviews', ['user_id'])


def downgrade():
    op.drop_index('ix_diary_weekly_reviews_user_id', table_name='diary_weekly_reviews')
    op.drop_table('diary_weekly_reviews')
