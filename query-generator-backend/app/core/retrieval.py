"""
RAG retrieval functionality
"""
import uuid
from typing import Any, Dict, List, Optional

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.openai_client import embed_single_text
from app.core.qdrant_client import qdrant_store
from app.models.vector import Embedding

logger = structlog.get_logger()


# Per-kind retrieval budget. Corrections and examples are the most actionable
# evidence for the LLM, so we always reserve slots for them and never let raw
# schema chunks crowd them out.
KIND_BUDGET = {
    "correction": 5,
    "example": 5,
    "metric": 3,
    "note": 3,
    "object": 10,
}


async def _search_kind(
    question_embedding: List[float],
    catalog_id: uuid.UUID,
    kind: str,
    limit: int,
    extra_filters: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Search Qdrant filtered to a single kind."""
    filters = {"kind": kind}
    if extra_filters:
        filters.update(extra_filters)
    try:
        return await qdrant_store.search_similar(
            query_vector=question_embedding,
            catalog_id=catalog_id,
            limit=limit,
            filter_conditions=filters,
        )
    except Exception as e:
        logger.warning("Per-kind search failed", kind=kind, error=str(e))
        return []


async def retrieve_context(
    db: AsyncSession,
    question: str,
    catalog_id: uuid.UUID,
    max_chunks: Optional[int] = None,
    include_schemas: Optional[List[str]] = None,
    include_tables: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    Retrieve diversified context for a question.

    Runs one Qdrant search per chunk kind so that corrections / examples /
    metrics / notes always reach the LLM instead of getting outranked by
    schema chunks. Per-kind budgets live in `KIND_BUDGET`.
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

    overall_limit = max_chunks or settings.max_chunks

    # Schema/table focus only narrows the schema-object search; corrections
    # and examples must remain visible even if the user passes `include`.
    object_filters: Dict[str, Any] = {}
    if include_schemas:
        object_filters["schema"] = include_schemas[0]
    if include_tables:
        object_filters["table"] = include_tables[0]

    try:
        # Run per-kind searches in parallel-ish (Qdrant client is sync but cheap).
        results_by_kind: Dict[str, List[Dict[str, Any]]] = {}
        for kind, budget in KIND_BUDGET.items():
            extra = object_filters if kind == "object" else None
            results_by_kind[kind] = await _search_kind(
                question_embedding=question_embedding,
                catalog_id=catalog_id,
                kind=kind,
                limit=budget,
                extra_filters=extra,
            )

        # Merge respecting priority: corrections > examples > metrics > notes > objects.
        priority_order = ["correction", "example", "metric", "note", "object"]
        merged: List[Dict[str, Any]] = []
        seen_ids = set()
        for kind in priority_order:
            for r in results_by_kind.get(kind, []):
                pid = r["point_id"]
                if pid in seen_ids:
                    continue
                seen_ids.add(pid)
                merged.append(r)

        # Apply an overall cap, but make sure every kind that returned anything
        # keeps at least its top hit before we trim from the tail.
        if len(merged) > overall_limit:
            # Reserve top-1 per kind so a great correction is never dropped.
            reserved = []
            reserved_ids = set()
            for kind in priority_order:
                hits = results_by_kind.get(kind) or []
                if hits and hits[0]["point_id"] not in reserved_ids:
                    reserved.append(hits[0])
                    reserved_ids.add(hits[0]["point_id"])
            remainder = [r for r in merged if r["point_id"] not in reserved_ids]
            merged = reserved + remainder[: max(0, overall_limit - len(reserved))]

        # Hydrate content from PostgreSQL.
        context_chunks: List[Dict[str, Any]] = []
        for result in merged:
            point_id = result["point_id"]
            score = result["score"]

            stmt = select(Embedding).where(Embedding.qdrant_point_id == point_id)
            db_result = await db.execute(stmt)
            embedding_record = db_result.scalar_one_or_none()
            if not embedding_record:
                continue

            context_chunks.append({
                "content": embedding_record.content,
                "metadata": embedding_record.embedding_metadata,
                "kind": embedding_record.kind,
                "score": score,
                "distance": 1 - score,
            })

        logger.info(
            "Context retrieved",
            chunks_found=len(context_chunks),
            by_kind={
                k: sum(1 for c in context_chunks if c["kind"] == k)
                for k in priority_order
            },
            avg_score=(
                sum(c["score"] for c in context_chunks) / len(context_chunks)
                if context_chunks else 0
            ),
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

    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for chunk in chunks:
        by_kind.setdefault(chunk["kind"], []).append(chunk)

    # Highest-priority first: human corrections are authoritative for the LLM.
    if "correction" in by_kind:
        context_parts.append("\n--- USER CORRECTIONS (authoritative — follow these) ---")
        for chunk in by_kind["correction"]:
            context_parts.append(chunk["content"])
            context_parts.append("")

    if "example" in by_kind:
        context_parts.append("--- EXAMPLES ---")
        for chunk in by_kind["example"]:
            context_parts.append(chunk["content"])
            context_parts.append("")

    if "metric" in by_kind:
        context_parts.append("--- METRICS ---")
        for chunk in by_kind["metric"]:
            context_parts.append(chunk["content"])
            context_parts.append("")

    if "object" in by_kind:
        context_parts.append("--- DATABASE SCHEMA ---")
        for chunk in by_kind["object"]:
            context_parts.append(chunk["content"])
            context_parts.append("")

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