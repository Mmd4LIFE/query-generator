"""
Runtime settings model — DB-backed configuration that admins can edit
without redeploying. See `app.core.settings_service` for read/write helpers
and `app.core.settings_seed` for the registry of known keys and defaults.
"""
import uuid
from typing import Any, Optional

from sqlalchemy import JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Setting(Base, UUIDMixin, TimestampMixin):
    """A single tunable. Identified by `key`, value held as JSON for type flexibility."""
    __tablename__ = "dq_settings"

    key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    def __repr__(self) -> str:
        return f"<Setting(key='{self.key}', category='{self.category}')>"
