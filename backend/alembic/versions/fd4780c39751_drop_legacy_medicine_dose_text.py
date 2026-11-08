"""drop legacy medicine dose text

Revision ID: fd4780c39751
Revises: 7b7c83feb28f
Create Date: 2026-11-08 14:18:43.179934

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fd4780c39751'
down_revision: Union[str, Sequence[str], None] = '7b7c83feb28f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """The API now uses dose_amount and dose_unit; the old free-text column is no longer read or written."""
    op.drop_column('medicines', 'dose')


def downgrade() -> None:
    op.add_column('medicines', sa.Column('dose', sa.String(length=120), nullable=False, server_default=''))
    # rebuild the text from the structured dose, e.g. 5.00 drops -> "5 drops", 0.50 ml -> "0.5 ml"
    op.execute("""
        update medicines
        set dose = trim(trailing '.' from regexp_replace(dose_amount::text, '0+$', '')) || ' ' || dose_unit
        where dose_amount is not null
    """)
    op.alter_column('medicines', 'dose', server_default=None)
