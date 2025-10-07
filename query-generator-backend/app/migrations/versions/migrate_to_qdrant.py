"""migrate to qdrant

Revision ID: migrate_to_qdrant
Revises: d5ab2d2fe7c0
Create Date: 2025-10-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'migrate_to_qdrant'
down_revision: Union[str, None] = 'd5ab2d2fe7c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the pgvector extension if it exists
    op.execute('DROP EXTENSION IF EXISTS vector CASCADE')
    
    # Drop the embedding column (pgvector type) if it exists
    # Use raw SQL to handle the case where column doesn't exist
    op.execute('''
        DO $$ 
        BEGIN
            IF EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_name='dq_embeddings' 
                AND column_name='embedding'
            ) THEN
                ALTER TABLE dq_embeddings DROP COLUMN embedding;
            END IF;
        END $$;
    ''')
    
    # Add qdrant_point_id column if it doesn't exist
    op.execute('''
        DO $$ 
        BEGIN
            IF NOT EXISTS (
                SELECT 1 
                FROM information_schema.columns 
                WHERE table_name='dq_embeddings' 
                AND column_name='qdrant_point_id'
            ) THEN
                ALTER TABLE dq_embeddings ADD COLUMN qdrant_point_id VARCHAR(255);
                CREATE INDEX ix_dq_embeddings_qdrant_point_id ON dq_embeddings(qdrant_point_id);
            END IF;
        END $$;
    ''')


def downgrade() -> None:
    # Remove qdrant_point_id column
    op.drop_index(op.f('ix_dq_embeddings_qdrant_point_id'), table_name='dq_embeddings')
    op.drop_column('dq_embeddings', 'qdrant_point_id')
    
    # Re-enable pgvector extension
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')
    
    # Re-add embedding column
    # Note: This will lose all embedding data, but it's necessary for downgrade
    op.execute('ALTER TABLE dq_embeddings ADD COLUMN embedding vector(3072)')

