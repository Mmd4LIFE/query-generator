"""
Vector embeddings model for RAG retrieval
"""
import uuid
from typing import Any, Dict, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings
from app.models.base import Base, TimestampMixin, UUIDMixin


class Embedding(Base, UUIDMixin, TimestampMixin):
    """Vector embeddings for RAG retrieval"""
    __tablename__ = "dq_embeddings"
    
    # Content and embedding
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list] = mapped_column(Vector(settings.embedding_dimension), nullable=False)
    
    # Classification
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # object, note, metric, example
    catalog_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    
    # Source object references
    object_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    note_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    metric_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    example_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    
    # Metadata for retrieval context
    embedding_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    def __repr__(self) -> str:
        return f"<Embedding(kind='{self.kind}', catalog_id='{self.catalog_id}')>" 