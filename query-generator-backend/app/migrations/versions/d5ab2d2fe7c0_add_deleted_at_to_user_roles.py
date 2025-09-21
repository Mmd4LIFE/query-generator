"""add_deleted_at_to_user_roles

Revision ID: d5ab2d2fe7c0
Revises: e589e92b779b
Create Date: 2025-01-27 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'd5ab2d2fe7c0'
down_revision = 'e589e92b779b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add deleted_at column to auth_user_roles
    op.add_column('auth_user_roles', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    
    # Create index for better performance on active roles query
    op.create_index(
        'idx_auth_user_roles_active', 
        'auth_user_roles', 
        ['user_id', 'deleted_at'], 
        postgresql_where=sa.text('deleted_at IS NULL')
    )


def downgrade() -> None:
    # Drop index
    op.drop_index('idx_auth_user_roles_active', table_name='auth_user_roles')
    
    # Remove deleted_at column
    op.drop_column('auth_user_roles', 'deleted_at') 