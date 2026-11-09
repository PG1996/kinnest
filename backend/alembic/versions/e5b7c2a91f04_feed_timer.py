"""feed timer: a feed being timed right now

Revision ID: e5b7c2a91f04
Revises: d81f4a2c9e63
Create Date: 2026-11-10 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5b7c2a91f04'
down_revision: Union[str, Sequence[str], None] = 'd81f4a2c9e63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'feed_timers',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('family_id', sa.Uuid(), nullable=False),
        sa.Column('kid_id', sa.Uuid(), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('started_by_user_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['family_id'], ['families.id']),
        sa.ForeignKeyConstraint(['kid_id'], ['kids.id']),
        sa.ForeignKeyConstraint(['started_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('kid_id'),
        sa.CheckConstraint("type in ('breast_left','breast_right','breast_both','expressed','formula')", name='ck_feed_timer_type'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('feed_timers')
