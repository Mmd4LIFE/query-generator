"""Add dq_settings table and cost_usd column on dq_history

Revision ID: a1c4f7b9e3d2
Revises: d5ab2d2fe7c0
Create Date: 2026-05-17 13:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1c4f7b9e3d2"
down_revision: Union[str, None] = "d5ab2d2fe7c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create dq_settings; add cost_usd on dq_history. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS dq_settings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key VARCHAR(128) NOT NULL UNIQUE,
            value JSONB NOT NULL,
            category VARCHAR(32) NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            updated_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_dq_settings_key ON dq_settings (key);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_dq_settings_category ON dq_settings (category);"
    )

    # cost_usd on history — nullable, doubles
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'dq_history' AND column_name = 'cost_usd'
            ) THEN
                ALTER TABLE dq_history ADD COLUMN cost_usd DOUBLE PRECISION;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    """Drop dq_settings and cost_usd."""
    op.execute("ALTER TABLE dq_history DROP COLUMN IF EXISTS cost_usd;")
    op.execute("DROP INDEX IF EXISTS ix_dq_settings_category;")
    op.execute("DROP INDEX IF EXISTS ix_dq_settings_key;")
    op.execute("DROP TABLE IF EXISTS dq_settings;")
