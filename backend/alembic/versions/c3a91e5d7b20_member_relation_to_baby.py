"""member relation to the baby

Revision ID: c3a91e5d7b20
Revises: 76943e5ba803
Create Date: 2026-11-09 22:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3a91e5d7b20'
down_revision: Union[str, Sequence[str], None] = '76943e5ba803'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RELATIONS = "relation is null or relation in ('mom','dad','grandparent','relative','nanny','other')"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('memberships', sa.Column('relation', sa.String(length=20), nullable=True))
    op.add_column('invites', sa.Column('relation', sa.String(length=20), nullable=True))
    # alembic does not see CHECK constraints or partial indexes: added by hand
    op.create_check_constraint('ck_membership_relation', 'memberships', RELATIONS)
    op.create_check_constraint('ck_invite_relation', 'invites', RELATIONS)
    op.create_index('uq_membership_parent', 'memberships', ['family_id', 'relation'], unique=True, postgresql_where=sa.text("relation in ('mom','dad')"))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_membership_parent', table_name='memberships')
    op.drop_constraint('ck_invite_relation', 'invites', type_='check')
    op.drop_constraint('ck_membership_relation', 'memberships', type_='check')
    op.drop_column('invites', 'relation')
    op.drop_column('memberships', 'relation')
