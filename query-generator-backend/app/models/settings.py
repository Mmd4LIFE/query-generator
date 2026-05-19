"""
Runtime settings — DB-backed configuration editable by Generals (global) and
Colonels (sector-scoped). Resolution order: sector value -> global value
-> hard-coded default.
"""
import uuid
from typing import Any, Optional

from sqlalchemy import ForeignKey, Index, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Setting(Base, UUIDMixin, TimestampMixin):
    """
    One tunable, identified by (key, scope, sector_id).
    - scope='global', sector_id IS NULL — applies everywhere unless overridden.
    - scope='sector', sector_id IS NOT NULL — overrides the global for that sector.
    """
    __tablename__ = "dq_settings"
    __table_args__ = (
        UniqueConstraint("key", "scope", "sector_id", name="uq_settings_key_scope_sector"),
        Index("ix_settings_key_scope", "key", "scope"),
    )

    key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False, default="global")  # 'global' | 'sector'
    sector_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="CASCADE"),
        nullable=True,
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=True,
    )

    def __repr__(self) -> str:
        sid = self.sector_id or "global"
        return f"<Setting(key='{self.key}', scope='{self.scope}', sector='{sid}')>"
