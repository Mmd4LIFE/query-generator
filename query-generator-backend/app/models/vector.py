"""
Vector embedding metadata. The actual 3072-dim vector lives in Qdrant; this
table holds the content text, sector scoping, and concrete FKs to whichever
domain row produced it.

The Qdrant point ID is `Embedding.id` directly — no separate `qdrant_point_id`
column (one source of truth, see ROADMAP.md §6.3).
"""
import uuid
from typing import Any, Dict, Optional

from sqlalchemy import CheckConstraint, ForeignKey, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Embedding(Base, UUIDMixin, TimestampMixin):
    """
    One embedded chunk. Exactly one of {object,note,metric,example,correction}_id
    is non-null, enforced by a CHECK constraint.
    """
    __tablename__ = "dq_embeddings"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN object_id     IS NOT NULL THEN 1 ELSE 0 END"
            " + CASE WHEN note_id       IS NOT NULL THEN 1 ELSE 0 END"
            " + CASE WHEN metric_id     IS NOT NULL THEN 1 ELSE 0 END"
            " + CASE WHEN example_id    IS NOT NULL THEN 1 ELSE 0 END"
            " + CASE WHEN correction_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_embedding_exactly_one_fk",
        ),
    )

    # Content (text that was embedded — the same string that produced the vector).
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # Denormalized convenience filter — kept in sync with whichever FK is set.
    kind: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    # Sector scoping — primary defence against cross-tenant retrieval leaks.
    sector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Optional catalog scoping (notes/metrics/examples can be sector-global).
    catalog_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_catalogs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Concrete polymorphism — exactly one non-null per row.
    object_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_objects.id", ondelete="CASCADE"),
        nullable=True,
    )
    note_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_notes.id", ondelete="CASCADE"),
        nullable=True,
    )
    metric_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_metrics.id", ondelete="CASCADE"),
        nullable=True,
    )
    example_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_examples.id", ondelete="CASCADE"),
        nullable=True,
    )
    correction_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_corrections.id", ondelete="CASCADE"),
        nullable=True,
    )

    # The embedding model name at the time of generation — used to refuse
    # cross-model retrievals when the global setting changes (see retrieval.py).
    embed_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Metadata for retrieval context (schema/table/comment-derived fields, etc.)
    embedding_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    def __repr__(self) -> str:
        return f"<Embedding(kind='{self.kind}', sector_id='{self.sector_id}')>"
