"""
RAG retrieval functionality
"""
import re
import uuid
from typing import Any, Dict, Iterable, List, Optional, Set

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.openai_client import embed_single_text
from app.core.qdrant_client import qdrant_store
from app.models.vector import Embedding

logger = structlog.get_logger()


# -----------------------------------------------------------------------------
# Table-reference extraction
# -----------------------------------------------------------------------------

# Matches `something.something` — covers both `schema.table` and `table.column`.
# We can't always tell which is which without context, so we extract BOTH
# identifiers and let the catalog lookup filter false positives (e.g. the
# schema half of a `schema.table` won't match any real table name).
_QUALIFIED_REF_RE = re.compile(r"\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\b")

# Matches `FROM table`, `JOIN table`, `UPDATE table`, `INTO table`, including
# the optional schema-qualified or backtick/double-quote-quoted variants.
_SQL_KEYWORD_REF_RE = re.compile(
    r"\b(?:from|join|update|into)\s+[`\"]?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)[`\"]?",
    re.IGNORECASE,
)

# SQL functions/keywords that look like identifiers and would otherwise be
# captured by the patterns above. We strip them client-side so we don't waste
# a PG round-trip looking up a table called `date` or `count`.
_NON_TABLE_TOKENS = {
    # SQL keywords that can appear after FROM/JOIN/UPDATE/INTO in subqueries
    "select", "values", "lateral", "only", "table",
    # Common functions seen in metric expressions / column names
    "sum", "count", "avg", "min", "max", "date", "extract", "coalesce",
    "nullif", "cast", "case", "when", "then", "else", "end", "null",
    "true", "false", "and", "or", "not", "in", "exists", "between",
    "like", "ilike", "is", "as", "on", "by", "group", "order", "having",
    "where", "limit", "offset", "union", "intersect", "except",
}


def _extract_table_refs(text: str) -> Set[str]:
    """Pull out candidate table-name tokens from chunk content.

    Returns a set of lowercased identifiers — the caller looks them up
    case-insensitively against the catalog. False positives (schema names,
    function names that slipped through the filter) are harmless: they just
    won't match any real table.
    """
    if not text:
        return set()

    candidates: Set[str] = set()

    # 1. Qualified `a.b` — table.column OR schema.table.
    for m in _QUALIFIED_REF_RE.finditer(text):
        for ident in (m.group(1), m.group(2)):
            tok = ident.lower()
            if tok not in _NON_TABLE_TOKENS:
                candidates.add(tok)

    # 2. SQL keyword anchors — FROM/JOIN/UPDATE/INTO.
    for m in _SQL_KEYWORD_REF_RE.finditer(text):
        ref = m.group(1)
        # `schema.table` → take the table portion (last component).
        tail = ref.split(".")[-1].lower()
        if tail not in _NON_TABLE_TOKENS:
            candidates.add(tail)

    return candidates


async def _force_include_referenced_tables(
    db: AsyncSession,
    catalog_id: uuid.UUID,
    knowledge_chunks: Iterable[Dict[str, Any]],
    already_included_tables: Set[str],
) -> List[Dict[str, Any]]:
    """Find tables mentioned in retrieved knowledge (notes/examples/metrics/
    corrections) and pull their schema chunks even if vector search didn't
    surface them.

    Why this matters: a Note like "GMV = sum of orders.filled_amount" has a
    strong embedding match against a question about GMV, but the `orders`
    table itself does NOT — so vector retrieval can give the LLM the
    instruction without the schema it needs to follow it. This step bridges
    that gap.
    """
    candidates: Set[str] = set()
    for chunk in knowledge_chunks:
        candidates |= _extract_table_refs(chunk.get("content", ""))

    # Anything already in context — skip.
    to_fetch = candidates - {t.lower() for t in already_included_tables if t}
    if not to_fetch:
        return []

    # Load all object chunks for the catalog and match in Python. Object
    # count per catalog is bounded (~one per table) so this is cheap and
    # avoids dialect-specific JSON-operator gymnastics.
    stmt = select(Embedding).where(
        Embedding.catalog_id == catalog_id,
        Embedding.kind == "object",
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    forced: List[Dict[str, Any]] = []
    matched_lower: Set[str] = set()
    for row in rows:
        meta = row.embedding_metadata or {}
        tbl = (meta.get("table") or "").lower()
        if not tbl or tbl in matched_lower:
            continue
        if tbl in to_fetch:
            forced.append({
                "content": row.content,
                "metadata": meta,
                "kind": row.kind,
                "score": 0.0,   # not from vector similarity
                "distance": 1.0,
                "forced": True,
            })
            matched_lower.add(tbl)

    if forced:
        logger.info(
            "Force-included referenced tables",
            count=len(forced),
            tables=[m.get("metadata", {}).get("table") for m in forced],
            candidates=sorted(to_fetch),
        )
    return forced


# Per-kind retrieval budget. Corrections and examples are the most actionable
# evidence for the LLM, so we always reserve slots for them and never let raw
# schema chunks crowd them out. Editable at runtime via the
# `retrieval.kind_budget` setting; this dict is the safe fallback.
DEFAULT_KIND_BUDGET = {
    "correction": 5,
    "example": 5,
    "metric": 3,
    "note": 3,
    "object": 15,
}


async def _get_kind_budget() -> Dict[str, int]:
    """Read the live kind-budget from settings, falling back to the default."""
    try:
        from app.core.settings_service import get_value_standalone
        value = await get_value_standalone("retrieval.kind_budget")
        if isinstance(value, dict):
            # Trust validation at write-time; coerce to int just in case.
            return {k: int(v) for k, v in value.items()}
    except Exception as e:
        logger.warning("Falling back to default kind_budget", error=str(e))
    return dict(DEFAULT_KIND_BUDGET)


async def _get_max_chunks_setting() -> Optional[int]:
    """Read the live overall cap from settings; None defers to caller default."""
    try:
        from app.core.settings_service import get_value_standalone
        value = await get_value_standalone("retrieval.max_chunks")
        if isinstance(value, int) and value > 0:
            return value
    except Exception as e:
        logger.warning("Falling back to settings.max_chunks for cap", error=str(e))
    return None


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

    overall_limit = max_chunks or (await _get_max_chunks_setting()) or settings.max_chunks
    kind_budget = await _get_kind_budget()

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
        for kind, budget in kind_budget.items():
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

        # Knowledge-driven force-include: when a Note/Example/Metric/Correction
        # references a table (e.g. "GMV = sum of orders.filled_amount"), make
        # sure that table's schema chunk reaches the LLM even if the question
        # embedding didn't rank it in the top-N. Without this, the model gets
        # the instruction without the schema needed to follow it.
        knowledge = [
            c for c in context_chunks
            if c["kind"] in {"correction", "example", "metric", "note"}
        ]
        existing_tables = {
            (c.get("metadata") or {}).get("table")
            for c in context_chunks
            if c["kind"] == "object"
        }
        existing_tables.discard(None)
        forced = await _force_include_referenced_tables(
            db=db,
            catalog_id=catalog_id,
            knowledge_chunks=knowledge,
            already_included_tables=existing_tables,
        )
        if forced:
            context_chunks.extend(forced)

        logger.info(
            "Context retrieved",
            chunks_found=len(context_chunks),
            by_kind={
                k: sum(1 for c in context_chunks if c["kind"] == k)
                for k in priority_order
            },
            forced_objects=len(forced),
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