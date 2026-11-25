"""Encrypted resumable PDF statement processing."""
from alembic import op
import sqlalchemy as sa
from app.core.database import UTCDateTime


revision = '0022_pdf_batches'
down_revision = '0021_results'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('finance_csv_imports', sa.Column('pdf_payload', sa.Text(), nullable=True))
    op.add_column('finance_csv_imports', sa.Column('pdf_claim_until', UTCDateTime(), nullable=True))


def downgrade():
    op.drop_column('finance_csv_imports', 'pdf_claim_until')
    op.drop_column('finance_csv_imports', 'pdf_payload')
