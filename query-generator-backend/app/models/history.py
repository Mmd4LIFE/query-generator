"""
Query generation history and feedback models
"""
import uuid
from typing import Any, Dict, Optional

from sqlalchemy import JSON, Boolean, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class QueryHistory(Base, UUIDMixin, TimestampMixin):
    """Query generation history model"""
    __tablename__ = "dq_history"
    
    # Request context
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    catalog_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
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
    generation_time_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    
    # Retrieval context (redacted for privacy)
    context_chunks: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    context_sources: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    # Status
    status: Mapped[str] = mapped_column(String(20), default="success", nullable=False)  # success, error, timeout
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    def __repr__(self) -> str:
        return f"<QueryHistory(user_id='{self.user_id}', status='{self.status}')>"


class QueryFeedback(Base, UUIDMixin, TimestampMixin):
    """User feedback on generated queries"""
    __tablename__ = "dq_feedback"
    
    history_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    
    # Feedback
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-5 scale
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Specific feedback categories
    correctness: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-5
    completeness: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-5
    efficiency: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-5
    
    # Suggested improvements
    suggested_sql: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    improvement_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    def __repr__(self) -> str:
        return f"<QueryFeedback(history_id='{self.history_id}', rating={self.rating})>" 