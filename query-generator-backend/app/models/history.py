"""
Query generation history and feedback models. Sector-scoped + FKs.
"""
import uuid
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class QueryHistory(Base, UUIDMixin, TimestampMixin):
    """Query generation history model"""
    __tablename__ = "dq_history"
    __table_args__ = (
        Index("ix_history_sector_user_time", "sector_id", "user_id", "created_at"),
        Index("ix_history_sector_time", "sector_id", "created_at"),
    )

    # Tenancy
    sector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    # Request context
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    catalog_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_catalogs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    engine: Mapped[str] = mapped_column(String(50), nullable=False)

    # Input
    question: Mapped[str] = mapped_column(Text, nullable=False)
    constraints: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Output
    generated_sql: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Validation results
    syntax_valid: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    policy_violations: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    guardrails_applied: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Generation metadata
    model_used: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    prompt_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # 'ok' | 'unknown_model' | 'missing_usage' — explains why cost_usd may be NULL.
    cost_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    generation_time_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Retrieval context — counts (back-compat) + the actual chunks used.
    context_chunks: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    context_sources: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    # [{"embedding_id": "...", "kind": "...", "score": 0.87}, ...] — for post-hoc debugging.
    context_chunk_ids: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(String(20), default="success", nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Stable UUID for log-correlation when an error is returned to the client.
    correlation_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)

    def __repr__(self) -> str:
        return f"<QueryHistory(user_id='{self.user_id}', status='{self.status}')>"


class QueryFeedback(Base, UUIDMixin, TimestampMixin):
    """User feedback on generated queries — cascades with its parent history row."""
    __tablename__ = "dq_feedback"

    sector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    history_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_history.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Feedback
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-5
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    correctness: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completeness: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    efficiency: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Suggested improvements — promoted to Correction on approval (see app.models.correction).
    suggested_sql: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    improvement_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Tracks whether this feedback has been converted into an approved Correction.
    correction_status: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # None | 'pending' | 'approved' | 'rejected'

    def __repr__(self) -> str:
        return f"<QueryFeedback(history_id='{self.history_id}', rating={self.rating})>"
