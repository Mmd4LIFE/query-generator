"""
Policy models for SQL generation guardrails
"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, Boolean, Integer, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Policy(Base, UUIDMixin, TimestampMixin):
    """
    Policy model for catalog-specific guardrails.
    
    Uses soft delete pattern:
    - When policy is updated, old row is soft-deleted and new row is created
    - Active policy is where deleted_at IS NULL
    - This creates full audit trail of all policy changes
    """
    __tablename__ = "dq_policies"
    
    catalog_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    
    # Basic policies
    allow_write: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    default_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=1000)
    
    # Banned items
    banned_tables: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True, default=list)
    banned_columns: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True, default=list)
    banned_schemas: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True, default=list)
    
    # PII handling
    pii_tags: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True, default=list)
    pii_masking_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    # Advanced policies
    max_rows_returned: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    allowed_functions: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    blocked_functions: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
    
    # Additional settings
    settings: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, default=dict)
    
    # Authorship (soft delete pattern - no updated_by, only created_by and deleted_by)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    
    # Soft delete fields
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None)
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, default=None)
    
    def __repr__(self) -> str:
        status = "deleted" if self.deleted_at else "active"
        return f"<Policy(catalog_id='{self.catalog_id}', status='{status}', allow_write={self.allow_write})>" 