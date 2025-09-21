"""
RAG retrieval functionality
"""
import uuid
from typing import Any, Dict, List, Optional, Tuple

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.openai_client import embed_single_text
from app.models.vector import Embedding

logger = structlog.get_logger()


async def retrieve_context(
    db: AsyncSession,
    question: str,
    catalog_id: uuid.UUID,
    max_chunks: Optional[int] = None,
    include_schemas: Optional[List[str]] = None,
    include_tables: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    Retrieve relevant context chunks for a question using vector similarity.
    
    Args:
        db: Database session
        question: Natural language question
        catalog_id: Catalog ID to search within
        max_chunks: Maximum number of chunks to retrieve
        include_schemas: Optional list of schemas to focus on
        include_tables: Optional list of tables to focus on
        
    Returns:
        List of context chunks with metadata
    """
    logger.info(
        "Retrieving context",
        question_length=len(question),
        catalog_id=catalog_id,
        max_chunks=max_chunks
    )
    
    # Generate embedding for the question
    question_embedding = await embed_single_text(question)
    if not question_embedding:
        logger.error("Failed to generate question embedding")
        return []
    
    # Build the query
    max_chunks = max_chunks or settings.max_chunks
    
    # Base query with cosine similarity
    query = text("""
        SELECT 
            content,
            embedding_metadata,
            kind,
            (embedding <=> :question_embedding) as distance
        FROM dq_embeddings
        WHERE catalog_id = :catalog_id
    """)
    
    # Add schema/table filters if specified
    filters = []
    params = {
        "question_embedding": str(question_embedding),
        "catalog_id": catalog_id,
        "max_chunks": max_chunks
    }
    
    if include_schemas:
        filters.append("(embedding_metadata->>'schema' = ANY(:include_schemas))")
        params["include_schemas"] = include_schemas
    
    if include_tables:
        filters.append("(embedding_metadata->>'table' = ANY(:include_tables))")
        params["include_tables"] = include_tables
    
    if filters:
        query = text(str(query) + " AND " + " AND ".join(filters))
    
    # Add ordering and limit
    query = text(str(query) + " ORDER BY distance ASC LIMIT :max_chunks")
    
    # Execute query
    try:
        result = await db.execute(query, params)
        rows = result.fetchall()
        
        context_chunks = []
        for row in rows:
            context_chunks.append({
                "content": row.content,
                "metadata": row.embedding_metadata,
                "kind": row.kind,
                "distance": float(row.distance)
            })
        
        logger.info(
            "Context retrieved",
            chunks_found=len(context_chunks),
            avg_distance=sum(c["distance"] for c in context_chunks) / len(context_chunks) if context_chunks else 0
        )
        
        return context_chunks
        
    except Exception as e:
        logger.error("Failed to retrieve context", error=str(e))
        return []


def build_context_string(chunks: List[Dict[str, Any]]) -> str:
    """
    Build a context string from retrieved chunks.
    
    Args:
        chunks: List of context chunks
        
    Returns:
        Formatted context string
    """
    if not chunks:
        return ""
    
    context_parts = ["=== RELEVANT CONTEXT ==="]
    
    # Group chunks by kind
    by_kind = {}
    for chunk in chunks:
        kind = chunk["kind"]
        if kind not in by_kind:
            by_kind[kind] = []
        by_kind[kind].append(chunk)
    
    # Add object chunks first (tables/columns)
    if "object" in by_kind:
        context_parts.append("\n--- DATABASE SCHEMA ---")
        for chunk in by_kind["object"]:
            context_parts.append(chunk["content"])
            context_parts.append("")  # Empty line
    
    # Add metrics
    if "metric" in by_kind:
        context_parts.append("--- METRICS ---")
        for chunk in by_kind["metric"]:
            context_parts.append(chunk["content"])
            context_parts.append("")
    
    # Add examples
    if "example" in by_kind:
        context_parts.append("--- EXAMPLES ---")
        for chunk in by_kind["example"]:
            context_parts.append(chunk["content"])
            context_parts.append("")
    
    # Add notes
    if "note" in by_kind:
        context_parts.append("--- NOTES ---")
        for chunk in by_kind["note"]:
            context_parts.append(chunk["content"])
            context_parts.append("")
    
    context_parts.append("=== END CONTEXT ===")
    
    return "\n".join(context_parts)


async def get_context_summary(
    db: AsyncSession,
    catalog_id: uuid.UUID
) -> Dict[str, Any]:
    """
    Get a summary of available context for a catalog.
    
    Args:
        db: Database session
        catalog_id: Catalog ID
        
    Returns:
        Context summary
    """
    stmt = select(Embedding.kind, Embedding.embedding_metadata).where(
        Embedding.catalog_id == catalog_id
    )
    result = await db.execute(stmt)
    embeddings = result.fetchall()
    
    summary = {
        "total_chunks": len(embeddings),
        "by_kind": {},
        "schemas": set(),
        "tables": set()
    }
    
    for embedding in embeddings:
        kind = embedding.kind
        metadata = embedding.embedding_metadata or {}
        
        # Count by kind
        summary["by_kind"][kind] = summary["by_kind"].get(kind, 0) + 1
        
        # Collect schemas and tables
        if "schema" in metadata:
            summary["schemas"].add(metadata["schema"])
        if "table" in metadata:
            summary["tables"].add(metadata["table"])
    
    # Convert sets to lists for JSON serialization
    summary["schemas"] = list(summary["schemas"])
    summary["tables"] = list(summary["tables"])
    
    return summary 