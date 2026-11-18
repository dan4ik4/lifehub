"""Cached monthly financial fact selections."""
from alembic import op
import sqlalchemy as sa
from app.core.database import UTCDateTime

revision = '0017_finance_review'
down_revision = '0016_pdf_import'
branch_labels = depends_on = None


def upgrade():
    op.create_table('finance_reviews',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('month', sa.String(7), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False),
        sa.Column('source_hash', sa.String(64), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('output', sa.JSON(), nullable=True),
        sa.Column('created_at', UTCDateTime(), nullable=False),
        sa.Column('updated_at', UTCDateTime(), nullable=False),
        sa.UniqueConstraint('user_id', 'month', 'currency'))
    op.create_index('ix_finance_reviews_user_id', 'finance_reviews', ['user_id'])


def downgrade():
    op.drop_index('ix_finance_reviews_user_id', table_name='finance_reviews')
    op.drop_table('finance_reviews')
