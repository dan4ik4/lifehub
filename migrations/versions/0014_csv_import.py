"""Confirmed CSV imports and duplicate protection."""
from alembic import op
import sqlalchemy as sa
from app.core.database import UTCDateTime

revision = '0014_csv_import'
down_revision = '0013_goal_tracking'
branch_labels = depends_on = None


def upgrade():
    op.create_table('finance_csv_imports',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('request_key', sa.String(128), nullable=False),
        sa.Column('request_hash', sa.String(64), nullable=False),
        sa.Column('account', sa.String(100), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('rows', sa.JSON(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('created_at', UTCDateTime(), nullable=False),
        sa.UniqueConstraint('user_id', 'request_key'))
    op.create_index('ix_finance_csv_imports_user_id', 'finance_csv_imports', ['user_id'])
    op.create_table('finance_csv_rows',
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('account_hash', sa.String(64), primary_key=True),
        sa.Column('fingerprint', sa.String(64), primary_key=True),
        sa.Column('transaction_id', sa.Uuid(), sa.ForeignKey('finance_transactions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', UTCDateTime(), nullable=False))


def downgrade():
    op.drop_table('finance_csv_rows')
    op.drop_index('ix_finance_csv_imports_user_id', table_name='finance_csv_imports')
    op.drop_table('finance_csv_imports')
