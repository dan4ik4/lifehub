"""Source-bound cross-module observation selections."""
from alembic import op
import sqlalchemy as sa
from app.core.database import UTCDateTime

revision = '0018_cross_reviews'
down_revision = '0017_finance_review'
branch_labels = depends_on = None


def upgrade():
    op.create_table('cross_module_reviews',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('scope_hash', sa.String(64), nullable=False),
        sa.Column('source_hash', sa.String(64), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('output', sa.JSON(), nullable=True),
        sa.Column('created_at', UTCDateTime(), nullable=False),
        sa.Column('updated_at', UTCDateTime(), nullable=False),
        sa.UniqueConstraint('user_id', 'scope_hash'))
    op.create_index('ix_cross_module_reviews_user_id', 'cross_module_reviews', ['user_id'])


def downgrade():
    op.drop_index('ix_cross_module_reviews_user_id', table_name='cross_module_reviews')
    op.drop_table('cross_module_reviews')
