"""
RAG retrieval — sector-scoped, parallel per-kind, batched Postgres hydration.

Pipeline
========
1. Embed the question (current `embeddings.embed_model` setting).
2. Run per-kind Qdrant searches **in parallel** (`asyncio.gather`), filtered
   to the caller's `sector_id` (mandatory) and `catalog_id` (mandatory) and
   the live `embed_model`. Each kind has its own slot budget so corrections
   and examples never get crowded out by raw schema chunks.
3. Merge & cap to `retrieval.max_chunks`. Reserve top-1 per kind so a
   great correction can never be dropped by tail trimming.
4. **Batch-hydrate** content from Postgres in one query (`Embedding.id
   IN (:ids)`) — one round-trip total, not N.
5. For `kind='object'` chunks, apply optional Maximal Marginal Relevance
   (MMR) using payload-side cosine to break up near-duplicate schema chunks.
6. Force-include any tables referenced inside retrieved knowledge chunks
   that weren't surfaced by the question vector directly.

Tenancy
=======
The `sector_id` filter is non-optional. The Qdrant client itself refuses
searches without it; this module enforces it again at the call boundary
so it's obvious in code review.
"""
import asyncio
import re
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.openai_client import embed_single_text
from app.core.qdrant_client import qdrant_store
from app.models.vector import Embedding

logger = structlog.get_logger()


# -----------------------------------------------------------------------------
# Table-reference extraction (unchanged behavior, kept for force-include)
# -----------------------------------------------------------------------------
_QUALIFIED_REF_RE = re.compile(r"\b([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)\b")
_SQL_KEYWORD_REF_RE = re.compile(
    r"\b(?:from|join|update|into)\s+[`\"]?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?)[`\"]?",
    re.IGNORECASE,
)
_NON_TABLE_TOKENS = {
    "select", "values", "lateral", "only", "table",
    "sum", "count", "avg", "min", "max", "date", "extract", "coalesce",
    "nullif", "cast", "case", "when", "then", "else", "end", "null",
    "true", "false", "and", "or", "not", "in", "exists", "between",
    "like", "ilike", "is", "as", "on", "by", "group", "order", "having",
    "where", "limit", "offset", "union", "intersect", "except",
}


def _extract_table_refs(text: str) -> Set[str]:
    if not text:
        return set()
    out: Set[str] = set()
    for m in _QUALIFIED_REF_RE.finditer(text):
        for ident in (m.group(1), m.group(2)):
            tok = ident.lower()
            if tok not in _NON_TABLE_TOKENS:
                out.add(tok)
    for m in _SQL_KEYWORD_REF_RE.finditer(text):
        tail = m.group(1).split(".")[-1].lower()
        if tail not in _NON_TABLE_TOKENS:
            out.add(tail)
    return out


async def _force_include_referenced_tables(
    db: AsyncSession,
    sector_id: uuid.UUID,
    catalog_id: uuid.UUID,
    knowledge_chunks: Iterable[Dict[str, Any]],
    already_included_tables: Set[str],
) -> List[Dict[str, Any]]:
    """Schema chunks for tables that retrieved knowledge mentions but the
    question vector didn't surface. Sector-scoped at the SQL level."""
    candidates: Set[str] = set()
    for chunk in knowledge_chunks:
        candidates |= _extract_table_refs(chunk.get("content", ""))
    to_fetch = candidates - {t.lower() for t in already_included_tables if t}
    if not to_fetch:
        return []

    stmt = select(Embedding).where(
        Embedding.sector_id == sector_id,
        Embedding.catalog_id == catalog_id,
        Embedding.kind == "object",
    )
    rows = (await db.execute(stmt)).scalars().all()

    forced: List[Dict[str, Any]] = []
    matched: Set[str] = set()
    for row in rows:
        meta = row.embedding_metadata or {}
        tbl = (meta.get("table") or "").lower()
        if not tbl or tbl in matched:
            continue
        if tbl in to_fetch:
            forced.append({
                "content": row.content,
                "metadata": meta,
                "kind": row.kind,
                "score": 0.0,
                "distance": 1.0,
                "forced": True,
            })
            matched.add(tbl)
    if forced:
        logger.info(
            "retrieval.force_included_tables",
            count=len(forced),
            tables=[m.get("metadata", {}).get("table") for m in forced],
            candidates=sorted(to_fetch),
        )
    return forced


# -----------------------------------------------------------------------------
# Settings access
# -----------------------------------------------------------------------------
DEFAULT_KIND_BUDGET = {
    "correction": 5,
    "example": 5,
    "metric": 3,
    "note": 3,
    "object": 15,
}


async def _get_kind_budget(sector_id: Optional[uuid.UUID]) -> Dict[str, int]:
    """Sector-scoped (falls back to global → default)."""
    try:
        from app.core.settings_service import get_value_standalone
        value = await get_value_standalone("retrieval.kind_budget", sector_id=sector_id)
        if isinstance(value, dict):
            return {k: int(v) for k, v in value.items()}
    except Exception as e:
        logger.warning("retrieval.kind_budget.fallback", error=str(e))
    return dict(DEFAULT_KIND_BUDGET)


async def _get_max_chunks(sector_id: Optional[uuid.UUID]) -> Optional[int]:
    try:
        from app.core.settings_service import get_value_standalone
        value = await get_value_standalone("retrieval.max_chunks", sector_id=sector_id)
        if isinstance(value, int) and value > 0:
            return value
    except Exception as e:
        logger.warning("retrieval.max_chunks.fallback", error=str(e))
    return None


async def _get_active_embed_model() -> Optional[str]:
    """Read the current `embeddings.embed_model` setting; None if unset."""
    try:
        from app.core.settings_service import get_value_standalone
        v = await get_value_standalone("embeddings.embed_model", sector_id=None)
        return v if isinstance(v, str) and v.strip() else None
    except Exception:
        return None


async def _get_mmr_lambda(sector_id: Optional[uuid.UUID]) -> Optional[float]:
    """Return MMR λ if it would actually re-rank (0 ≤ λ < 1), else None.

    Setting `retrieval.mmr_lambda = 1.0` (the registry default) means pure
    relevance — same behavior as before. We treat that as "disabled" so we
    can skip the extra Qdrant vector-fetch round-trip.
    """
    try:
        from app.core.settings_service import get_value_standalone
        v = await get_value_standalone("retrieval.mmr_lambda", sector_id=sector_id)
        if isinstance(v, (int, float)) and 0.0 <= float(v) < 1.0:
            return float(v)
    except Exception:
        pass
    return None


# -----------------------------------------------------------------------------
# Qdrant search helpers
# -----------------------------------------------------------------------------
async def _search_kind(
    question_embedding: List[float],
    sector_id: uuid.UUID,
    catalog_id: uuid.UUID,
    embed_model: Optional[str],
    kind: str,
    limit: int,
    extra_filters: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    filters: Dict[str, Any] = {"kind": kind}
    if extra_filters:
        filters.update(extra_filters)
    try:
        return await qdrant_store.search_similar(
            query_vector=question_embedding,
            sector_id=sector_id,
            catalog_id=catalog_id,
            limit=limit,
            embed_model=embed_model,
            filter_conditions=filters,
        )
    except Exception as e:
        logger.warning(
            "retrieval.kind_search_failed", kind=kind, error=str(e)
        )
        return []


# -----------------------------------------------------------------------------
# MMR (object kind only)
# -----------------------------------------------------------------------------
def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _mmr_rerank(
    candidates: List[Dict[str, Any]],
    *,
    lambda_: float,
    limit: int,
    vectors: Dict[str, List[float]],
) -> List[Dict[str, Any]]:
    """Greedy Maximal Marginal Relevance.

    `candidates` must be sorted by `score` desc. `vectors` maps `point_id`
    to its embedding vector. If a vector is missing we fall back to raw
    similarity for that candidate (we still keep them — partial information
    is better than dropping the chunk entirely).
    """
    if lambda_ >= 1.0 or len(candidates) <= 1:
        return candidates[:limit]

    selected: List[Dict[str, Any]] = []
    remaining = list(candidates)
    while remaining and len(selected) < limit:
        if not selected:
            selected.append(remaining.pop(0))
            continue
        best_i = 0
        best_score = -float("inf")
        for i, c in enumerate(remaining):
            v_c = vectors.get(c["point_id"])
            if v_c is None:
                # Without a vector we can't compute redundancy — fall back to relevance.
                mmr = c["score"]
            else:
                redundancy = max(
                    (
                        _cosine(v_c, vectors[s["point_id"]])
                        for s in selected
                        if vectors.get(s["point_id"]) is not None
                    ),
                    default=0.0,
                )
                mmr = lambda_ * c["score"] - (1 - lambda_) * redundancy
            if mmr > best_score:
                best_score, best_i = mmr, i
        selected.append(remaining.pop(best_i))
    return selected


# -----------------------------------------------------------------------------
# Main entry point
# -----------------------------------------------------------------------------
async def retrieve_context(
    db: AsyncSession,
    question: str,
    *,
    sector_id: uuid.UUID,
    catalog_id: uuid.UUID,
    max_chunks: Optional[int] = None,
    include_schemas: Optional[List[str]] = None,
    include_tables: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Retrieve diversified, sector-scoped context for a question.

    Returns a list of `{content, metadata, kind, score, distance, forced?}`
    dicts in priority order (correction > example > metric > note > object).
    """
    logger.info(
        "retrieval.start",
        question_length=len(question),
        sector_id=str(sector_id),
        catalog_id=str(catalog_id),
        max_chunks=max_chunks,
        include_schemas=include_schemas,
        include_tables=include_tables,
    )

    question_embedding = await embed_single_text(question)
    if not question_embedding:
        logger.error("retrieval.embed_failed")
        return []

    overall_limit = max_chunks or (await _get_max_chunks(sector_id)) or settings.max_chunks
    kind_budget = await _get_kind_budget(sector_id)
    embed_model = await _get_active_embed_model()
    mmr_lambda = await _get_mmr_lambda(sector_id)

    # Schema/table focus narrows ONLY the schema-object search. Knowledge
    # chunks (correction/example/metric/note) must remain visible even if
    # the caller passed `include` — knowledge can apply across tables.
    object_filters: Dict[str, Any] = {}
    if include_schemas:
        object_filters["schema"] = list(include_schemas)
    if include_tables:
        object_filters["table"] = list(include_tables)

    # ------------------------------------------------------------------
    # 1. Per-kind Qdrant searches — in parallel.
    # ------------------------------------------------------------------
    try:
        kinds = list(kind_budget.keys())
        # For objects, fetch extra so MMR has room to diversify.
        object_overfetch = 3 if mmr_lambda is not None else 1
        coros = [
            _search_kind(
                question_embedding=question_embedding,
                sector_id=sector_id,
                catalog_id=catalog_id,
                embed_model=embed_model,
                kind=k,
                limit=kind_budget[k] * (object_overfetch if k == "object" else 1),
                extra_filters=object_filters if k == "object" else None,
            )
            for k in kinds
        ]
        results = await asyncio.gather(*coros, return_exceptions=False)
        results_by_kind: Dict[str, List[Dict[str, Any]]] = dict(zip(kinds, results))

        # ----------------------------------------------------------------
        # 2. MMR rerank for objects (if configured).
        # ----------------------------------------------------------------
        if mmr_lambda is not None and results_by_kind.get("object"):
            obj_candidates = results_by_kind["object"]
            # Pull vectors for the candidates from Qdrant (one round-trip
            # via retrieve()). They aren't returned by query_points by default.
            point_ids = [c["point_id"] for c in obj_candidates]
            vec_lookup: Dict[str, List[float]] = {}
            try:
                fetched = await qdrant_store.async_client.retrieve(
                    collection_name=qdrant_store.collection_name,
                    ids=point_ids,
                    with_vectors=True,
                    with_payload=False,
                )
                for p in fetched:
                    if p.vector:
                        vec_lookup[str(p.id)] = list(p.vector)
            except Exception as e:
                logger.warning("retrieval.mmr_vector_fetch_failed", error=str(e))
            results_by_kind["object"] = _mmr_rerank(
                obj_candidates,
                lambda_=mmr_lambda,
                limit=kind_budget["object"],
                vectors=vec_lookup,
            )

        # ----------------------------------------------------------------
        # 3. Merge respecting priority order; reserve top-1 per kind.
        # ----------------------------------------------------------------
        priority = ["correction", "example", "metric", "note", "object"]
        merged: List[Dict[str, Any]] = []
        seen: Set[str] = set()
        for k in priority:
            for r in results_by_kind.get(k, []):
                pid = str(r["point_id"])
                if pid in seen:
                    continue
                seen.add(pid)
                merged.append(r)

        if len(merged) > overall_limit:
            reserved: List[Dict[str, Any]] = []
            reserved_ids: Set[str] = set()
            for k in priority:
                hits = results_by_kind.get(k) or []
                if hits:
                    pid = str(hits[0]["point_id"])
                    if pid not in reserved_ids:
                        reserved.append(hits[0])
                        reserved_ids.add(pid)
            tail = [r for r in merged if str(r["point_id"]) not in reserved_ids]
            merged = reserved + tail[: max(0, overall_limit - len(reserved))]

        # ----------------------------------------------------------------
        # 4. Hydrate content from Postgres in ONE query.
        # ----------------------------------------------------------------
        if not merged:
            return []

        id_values: List[uuid.UUID] = []
        for r in merged:
            try:
                id_values.append(uuid.UUID(str(r["point_id"])))
            except (ValueError, TypeError):
                continue
        rows_by_id: Dict[uuid.UUID, Embedding] = {}
        if id_values:
            stmt = select(Embedding).where(
                Embedding.id.in_(id_values),
                Embedding.sector_id == sector_id,
            )
            rows_by_id = {
                row.id: row for row in (await db.execute(stmt)).scalars().all()
            }

        context_chunks: List[Dict[str, Any]] = []
        for r in merged:
            try:
                rid = uuid.UUID(str(r["point_id"]))
            except (ValueError, TypeError):
                continue
            row = rows_by_id.get(rid)
            if row is None:
                # Qdrant has a point Postgres doesn't — tenant-mismatch or stale.
                # Drop silently; we filtered by sector_id on the SQL side so
                # cross-tenant leakage is impossible here.
                continue
            score = r["score"]
            context_chunks.append({
                "content": row.content,
                "metadata": row.embedding_metadata,
                "kind": row.kind,
                "score": score,
                "distance": 1 - score,
                "embed_id": str(rid),
            })

        # ----------------------------------------------------------------
        # 5. Force-include tables referenced by retrieved knowledge.
        # ----------------------------------------------------------------
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
            sector_id=sector_id,
            catalog_id=catalog_id,
            knowledge_chunks=knowledge,
            already_included_tables=existing_tables,
        )
        if forced:
            context_chunks.extend(forced)

        logger.info(
            "retrieval.done",
            chunks_found=len(context_chunks),
            by_kind={
                k: sum(1 for c in context_chunks if c["kind"] == k)
                for k in priority
            },
            forced_objects=len(forced),
            avg_score=(
                sum(c["score"] for c in context_chunks) / len(context_chunks)
                if context_chunks else 0
            ),
            mmr_lambda=mmr_lambda,
            embed_model=embed_model,
        )
        return context_chunks

    except Exception as e:
        logger.error("retrieval.failed", error=str(e), exc_info=True)
        return []


# -----------------------------------------------------------------------------
# Context-string assembly (unchanged contract — formats by kind)
# -----------------------------------------------------------------------------
def build_context_string(chunks: List[Dict[str, Any]]) -> str:
    if not chunks:
        return ""

    parts = ["=== RELEVANT CONTEXT ==="]
    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for chunk in chunks:
        by_kind.setdefault(chunk["kind"], []).append(chunk)

    if "correction" in by_kind:
        parts.append("\n--- USER CORRECTIONS (authoritative — follow these) ---")
        for chunk in by_kind["correction"]:
            parts.append(chunk["content"])
            parts.append("")
    if "example" in by_kind:
        parts.append("--- EXAMPLES ---")
        for chunk in by_kind["example"]:
            parts.append(chunk["content"])
            parts.append("")
    if "metric" in by_kind:
        parts.append("--- METRICS ---")
        for chunk in by_kind["metric"]:
            parts.append(chunk["content"])
            parts.append("")
    if "object" in by_kind:
        parts.append("--- DATABASE SCHEMA ---")
        for chunk in by_kind["object"]:
            parts.append(chunk["content"])
            parts.append("")
    if "note" in by_kind:
        parts.append("--- NOTES ---")
        for chunk in by_kind["note"]:
            parts.append(chunk["content"])
            parts.append("")
    parts.append("=== END CONTEXT ===")
    return "\n".join(parts)


# -----------------------------------------------------------------------------
# Sector-aware context summary
# -----------------------------------------------------------------------------
async def get_context_summary(
    db: AsyncSession,
    *,
    sector_id: uuid.UUID,
    catalog_id: uuid.UUID,
) -> Dict[str, Any]:
    stmt = select(Embedding.kind, Embedding.embedding_metadata).where(
        Embedding.sector_id == sector_id,
        Embedding.catalog_id == catalog_id,
    )
    rows = (await db.execute(stmt)).all()

    summary: Dict[str, Any] = {
        "total_chunks": len(rows),
        "by_kind": {},
        "schemas": set(),
        "tables": set(),
    }
    for kind, meta in rows:
        summary["by_kind"][kind] = summary["by_kind"].get(kind, 0) + 1
        meta = meta or {}
        if "schema" in meta:
            summary["schemas"].add(meta["schema"])
        if "table" in meta:
            summary["tables"].add(meta["table"])
    summary["schemas"] = sorted(summary["schemas"])
    summary["tables"] = sorted(summary["tables"])
    return summary
