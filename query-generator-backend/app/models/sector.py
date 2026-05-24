"""
Sector model — the tenancy boundary for the whole app.

War-literature naming (see ROADMAP.md §0):
    Sector  = environment / tenant
    General = root admin (no sector)
    Colonel = sector admin
    Captain = data engineer inside a sector
    Soldier = end user inside a sector

Every catalog, knowledge item, history row, policy and embedding lives
inside exactly one sector. Cross-sector reads are reserved for Generals.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Sector(Base, UUIDMixin, TimestampMixin):
    """A single tenant. Owns its own catalogs, knowledge, policies, history."""
    __tablename__ = "dq_sectors"

    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:
        try:
            return f"<Sector(code='{self.code}', name='{self.name}')>"
        except Exception:
            return "<Sector(detached)>"
