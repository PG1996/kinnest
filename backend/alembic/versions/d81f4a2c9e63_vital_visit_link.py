"""link a vitals reading to the doctor visit it was taken at

Revision ID: d81f4a2c9e63
Revises: c3a91e5d7b20
Create Date: 2026-11-09 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd81f4a2c9e63'
down_revision: Union[str, Sequence[str], None] = 'c3a91e5d7b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('vital_entries', sa.Column('visit_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_vital_entries_visit_id', 'vital_entries', 'doctor_visits', ['visit_id'], ['id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_vital_entries_visit_id', 'vital_entries', type_='foreignkey')
    op.drop_column('vital_entries', 'visit_id')
