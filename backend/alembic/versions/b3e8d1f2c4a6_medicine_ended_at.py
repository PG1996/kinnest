"""medicine ended_at: an admin can stop a medicine early

Revision ID: b3e8d1f2c4a6
Revises: a7c3e9d41b58
Create Date: 2026-11-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3e8d1f2c4a6'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9d41b58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Nullable and empty for every existing medicine: nothing already logged changes."""
    op.add_column('medicines', sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('medicines', 'ended_at')
