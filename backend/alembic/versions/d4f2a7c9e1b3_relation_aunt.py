"""relation to the baby: aunt

Revision ID: d4f2a7c9e1b3
Revises: b3e8d1f2c4a6
Create Date: 2026-11-11 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd4f2a7c9e1b3'
down_revision: Union[str, Sequence[str], None] = 'b3e8d1f2c4a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW = "relation is null or relation in ('mom','dad','grandparent','aunt','relative','nanny','other')"
OLD = "relation is null or relation in ('mom','dad','grandparent','relative','nanny','other')"


def _swap(rule: str) -> None:
    for name, table in (('ck_membership_relation', 'memberships'), ('ck_invite_relation', 'invites')):
        op.drop_constraint(name, table, type_='check')
        op.create_check_constraint(name, table, rule)


def upgrade() -> None:
    """Upgrade schema."""
    _swap(NEW)


def downgrade() -> None:
    """Downgrade schema: an aunt falls back to relative so the old rule holds."""
    op.execute("update memberships set relation = 'relative' where relation = 'aunt'")
    op.execute("update invites set relation = 'relative' where relation = 'aunt'")
    _swap(OLD)
