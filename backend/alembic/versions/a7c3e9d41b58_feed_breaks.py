"""feed breaks: pausing the feed timer, and the breaks saved with a feed

Revision ID: a7c3e9d41b58
Revises: e5b7c2a91f04
Create Date: 2026-11-10 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e9d41b58'
down_revision: Union[str, Sequence[str], None] = 'e5b7c2a91f04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('feed_timers', sa.Column('paused_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('feed_timers', sa.Column('paused_total_s', sa.Integer(), server_default='0', nullable=False))
    op.add_column('feeds', sa.Column('break_min', sa.Integer(), server_default='0', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('feeds', 'break_min')
    op.drop_column('feed_timers', 'paused_total_s')
    op.drop_column('feed_timers', 'paused_at')
