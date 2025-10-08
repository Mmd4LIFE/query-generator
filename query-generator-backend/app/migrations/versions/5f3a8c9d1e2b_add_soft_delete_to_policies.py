"""Add soft delete to policies

Revision ID: 5f3a8c9d1e2b
Revises: migrate_to_qdrant
Create Date: 2025-01-09 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '5f3a8c9d1e2b'
down_revision: Union[str, None] = 'migrate_to_qdrant'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add soft delete columns to dq_policies table.
    
    Changes:
    1. Remove unique constraint on catalog_id (allow multiple policies per catalog for history)
    2. Add deleted_at column (timestamp, nullable)
    3. Add deleted_by column (UUID, nullable)
    4. Remove updated_by column (not needed in soft delete pattern)
    5. Create index on (catalog_id, deleted_at) for efficient active policy lookup
    """
    # Drop unique constraint on catalog_id (if it exists)
    op.execute("""
        DO $$ 
        BEGIN
            IF EXISTS (
                SELECT 1 
                FROM pg_constraint 
                WHERE conname = 'dq_policies_catalog_id_key'
            ) THEN
                ALTER TABLE dq_policies DROP CONSTRAINT dq_policies_catalog_id_key;
            END IF;
        END $$;
    """)
    
    # Add soft delete columns (if they don't already exist)
    op.execute("""
        DO $$ 
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'dq_policies' AND column_name = 'deleted_at'
            ) THEN
                ALTER TABLE dq_policies ADD COLUMN deleted_at TIMESTAMP;
            END IF;
            
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'dq_policies' AND column_name = 'deleted_by'
            ) THEN
                ALTER TABLE dq_policies ADD COLUMN deleted_by UUID;
            END IF;
        END $$;
    """)
    
    # Remove updated_by column (if it exists, not needed in soft delete pattern)
    op.execute("""
        DO $$ 
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'dq_policies' AND column_name = 'updated_by'
            ) THEN
                ALTER TABLE dq_policies DROP COLUMN updated_by;
            END IF;
        END $$;
    """)
    
    # Create index for efficient active policy lookup (if it doesn't exist)
    op.execute("""
        DO $$ 
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes 
                WHERE indexname = 'ix_dq_policies_catalog_active'
            ) THEN
                CREATE INDEX ix_dq_policies_catalog_active 
                ON dq_policies (catalog_id, deleted_at);
            END IF;
        END $$;
    """)
    
    # Create partial unique index to ensure only one active policy per catalog (if it doesn't exist)
    # This ensures deleted_at IS NULL means there's only one active policy
    op.execute("""
        DO $$ 
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_indexes 
                WHERE indexname = 'ix_dq_policies_catalog_active_unique'
            ) THEN
                CREATE UNIQUE INDEX ix_dq_policies_catalog_active_unique 
                ON dq_policies (catalog_id) 
                WHERE deleted_at IS NULL;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    """
    Revert soft delete changes.
    
    WARNING: This will lose soft-deleted policy history!
    """
    # Drop indexes
    op.drop_index('ix_dq_policies_catalog_active_unique', table_name='dq_policies')
    op.drop_index('ix_dq_policies_catalog_active', table_name='dq_policies')
    
    # Add back updated_by column
    op.add_column('dq_policies', sa.Column('updated_by', postgresql.UUID(as_uuid=True), nullable=True))
    
    # Remove soft delete columns
    op.drop_column('dq_policies', 'deleted_by')
    op.drop_column('dq_policies', 'deleted_at')
    
    # Add back unique constraint on catalog_id
    # Note: This will fail if there are multiple policies per catalog
    # You would need to manually clean up the data first
    op.create_unique_constraint('dq_policies_catalog_id_key', 'dq_policies', ['catalog_id'])

