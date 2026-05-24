"""
Knowledge management models (notes, metrics, examples). Sector-scoped.
Approval rule: approved_by must differ from created_by (enforced in router).
"""
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class _KnowledgeMixin:
    """Shared columns for notes/metrics/examples."""

    @classmethod
    def __init_subclass__(cls, **kwargs):  # pragma: no cover - declarative-only
        super().__init_subclass__(**kwargs)


class Note(Base, UUIDMixin, TimestampMixin):
    """Notes and guidelines model"""
    __tablename__ = "dq_notes"

    sector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
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

    catalog_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_catalogs.id", ondelete="CASCADE"),
        nullable=True,
    )

    def __repr__(self) -> str:
        return f"<Note(title='{self.title}', status='{self.status}')>"


class Metric(Base, UUIDMixin, TimestampMixin):
    """Metrics definition model"""
    __tablename__ = "dq_metrics"

    sector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    expression: Mapped[str] = mapped_column(Text, nullable=False)
    engine: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tags: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
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

    catalog_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_catalogs.id", ondelete="CASCADE"),
        nullable=True,
    )

    metric_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    def __repr__(self) -> str:
        return f"<Metric(name='{self.name}', status='{self.status}')>"


class Example(Base, UUIDMixin, TimestampMixin):
    """Query examples model"""
    __tablename__ = "dq_examples"

    sector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    sql_snippet: Mapped[str] = mapped_column(Text, nullable=False)
    engine: Mapped[str] = mapped_column(String(50), nullable=False)
    tags: Mapped[Optional[List[str]]] = mapped_column(JSON, nullable=True)
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

    catalog_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_catalogs.id", ondelete="CASCADE"),
        nullable=True,
    )

    example_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    def __repr__(self) -> str:
        return f"<Example(title='{self.title}', engine='{self.engine}', status='{self.status}')>"
