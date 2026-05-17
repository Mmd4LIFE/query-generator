"""Drop the leftover full-unique index ix_dq_policies_catalog_id

Revision ID: b8e3a2c5d6f1
Revises: a1c4f7b9e3d2
Create Date: 2026-05-17 14:50:00.000000

The initial migration (e589e92b779b) created
`ix_dq_policies_catalog_id` as a UNIQUE index — back when the Policy
model had `unique=True` on `catalog_id`. The soft-delete migration
(5f3a8c9d1e2b) later introduced a partial unique index
`ix_dq_policies_catalog_active_unique` on (catalog_id) WHERE
deleted_at IS NULL — which is the correct constraint for the
soft-delete pattern — but FORGOT to drop the older full-unique
index. The two are incompatible: as soon as anything tries to
soft-delete a policy and insert a replacement, the old full-unique
index rejects the second row.

This migration drops the stale full-unique index. The column is
still indexed (model has `index=True`); `create_db_and_tables` /
SQLAlchemy will rebuild a non-unique index of the same name on
startup if one is missing, which is fine for query performance.

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e3a2c5d6f1"
down_revision: Union[str, None] = "a1c4f7b9e3d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the stale full-unique index, leave the partial one in place.

    Idempotent — only acts when the bad full-unique index actually exists,
    so re-running against an already-fixed DB is a no-op.
    """
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM pg_indexes
                WHERE indexname = 'ix_dq_policies_catalog_id'
                  AND tablename = 'dq_policies'
            ) THEN
                -- Only drop when it's actually the unique variant. If a
                -- later restart recreated it as a non-unique index, leave
                -- that alone (it's the correct shape).
                IF EXISTS (
                    SELECT 1
                    FROM pg_index i
                    JOIN pg_class c ON c.oid = i.indexrelid
                    WHERE c.relname = 'ix_dq_policies_catalog_id'
                      AND i.indisunique = TRUE
                ) THEN
                    DROP INDEX ix_dq_policies_catalog_id;
                END IF;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    """Recreate the full-unique index.

    NOTE: this will FAIL if any catalog has more than one policy row
    (active + soft-deleted), which is the normal state once the soft-delete
    pattern has been used. Provided only so alembic can walk the history.
    """
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_dq_policies_catalog_id "
        "ON dq_policies (catalog_id);"
    )
