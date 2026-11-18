"""Distinguish PDF and CSV previews; reuse confirmation and duplicate protection."""
from alembic import op
import sqlalchemy as sa

revision = '0016_pdf_import'
down_revision = '0015_diary_review'
branch_labels = depends_on = None


def upgrade():
    op.add_column('finance_csv_imports', sa.Column('source_format', sa.String(8), nullable=False, server_default='csv'))


def downgrade():
    op.drop_column('finance_csv_imports', 'source_format')
