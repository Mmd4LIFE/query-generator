"""
User correction — the closed half of the feedback loop.

When a soldier/captain submits feedback that includes `suggested_sql`, a
pending Correction row is filed. A Colonel approves it; on approval the
correction text is embedded and pushed to Qdrant as `kind='correction'`.
From then on, retrieval surfaces it as USER CORRECTIONS (authoritative).

The integrity rule `approved_by <> created_by` is enforced at the router
layer, not the DB, because the DB cannot see the auth principal.
"""
import uuid
from typing import Optional

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Correction(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "dq_corrections"

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
    # The history row that triggered this correction (the question the user disliked).
    history_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_history.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    question: Mapped[str] = mapped_column(Text, nullable=False)
    correct_sql: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)

    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=True,
    )

    def __repr__(self) -> str:
        return f"<Correction(history_id='{self.history_id}', status='{self.status}')>"
