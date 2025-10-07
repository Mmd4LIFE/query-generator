"""
Vector embeddings model for RAG retrieval (metadata only, vectors stored in Qdrant)
"""
import uuid
from typing import Any, Dict, Optional

from sqlalchemy import JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class Embedding(Base, UUIDMixin, TimestampMixin):
    """
    Vector embeddings metadata for RAG retrieval.
    Actual vectors are stored in Qdrant, this table stores metadata and references.
    
    Uses polymorphic pattern:
    - kind: 'object', 'note', 'metric', 'example' (entity type)
    - entity_id: UUID of the related entity (polymorphic foreign key)
    """
    __tablename__ = "dq_embeddings"
    
    # Content (text that was embedded)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    
    # Reference to Qdrant point ID (same as this record's UUID)
    qdrant_point_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    
    # Classification (entity type)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # object, note, metric, example
    catalog_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    
    # Polymorphic foreign key (single column for all entity types)
    # - If kind='object' → references dq_objects.id
    # - If kind='note' → references dq_notes.id
    # - If kind='metric' → references dq_metrics.id
    # - If kind='example' → references dq_examples.id
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    
    # Metadata for retrieval context
    embedding_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    def __repr__(self) -> str:
        return f"<Embedding(kind='{self.kind}', entity_id='{self.entity_id}', catalog_id='{self.catalog_id}')>" 