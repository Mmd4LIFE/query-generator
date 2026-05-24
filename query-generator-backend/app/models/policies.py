"""
Policy models for SQL generation guardrails. Sector-scoped via catalog.
"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Policy(Base, UUIDMixin, TimestampMixin):
    """
    Catalog-scoped policy. Soft-delete pattern: updates archive the old row
    and insert a new one. The partial unique index on (catalog_id) WHERE
    deleted_at IS NULL guarantees at most one active policy per catalog —
    see migration `f2c1a7b8d901_phase1_sector_overhaul`.
    """
    __tablename__ = "dq_policies"

    sector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    catalog_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_catalogs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

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

    settings: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True, default=dict)

    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, default=None)
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=True,
        default=None,
    )

    def __repr__(self) -> str:
        status = "deleted" if self.deleted_at else "active"
        return f"<Policy(catalog_id='{self.catalog_id}', status='{status}', allow_write={self.allow_write})>"
