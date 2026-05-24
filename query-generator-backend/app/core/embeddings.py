"""
Embeddings processing — sector-scoped, concrete-FK polymorphism.

What changed vs. the legacy file
================================
- **No `entity_id` / `qdrant_point_id`.** Each Embedding row sets exactly one
  of `{object,note,metric,example,correction}_id`; `Embedding.id` doubles as
  the Qdrant point ID. See `app/models/vector.py`.
- **Mandatory `sector_id`.** Derived once from the catalog and stamped on
  every Embedding row + Qdrant payload. This is the second line of defense
  against cross-tenant retrieval leaks; the Qdrant client refuses payloads
  without it.
- **Mandatory `embed_model`.** Read from the live `embeddings.embed_model`
  setting (falls back to env). Stamped on every row + payload so retrieval
  can refuse points embedded with a different model.
- **Corrections come from `Correction`, not raw feedback.** The Phase-5
  feedback loop files a pending `Correction`; only `status='approved'`
  corrections get embedded.
- **Dedup by (kind, FK), not (catalog_id, content).** Content strings can
  collide across rows; the FK can't.
- **Two-phase commit preserved.** PG flush → Qdrant upsert → PG commit;
  rollback PG + best-effort Qdrant cleanup on failure.
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional, Tuple

import structlog
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.openai_client import generate_embeddings
from app.core.qdrant_client import qdrant_store
from app.models.catalog import Catalog, CatalogObject
from app.models.correction import Correction
from app.models.knowledge import Example, Metric, Note
from app.models.vector import Embedding

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------

async def _resolve_active_embed_model() -> str:
    """Read the live `embeddings.embed_model`; fall back to env default.

    Kept in sync with `retrieval._get_active_embed_model` so the same model
    that writes also reads.
    """
    try:
        from app.core.settings_service import get_value_standalone
        v = await get_value_standalone("embeddings.embed_model", sector_id=None)
        if isinstance(v, str) and v.strip():
            return v
    except Exception as exc:
        logger.warning("embeddings.embed_model_setting_unreadable", error=str(exc))
    return settings.embed_model


# ---------------------------------------------------------------------------
# Chunk text builders (pure functions)
# ---------------------------------------------------------------------------

def create_table_chunk(
    catalog_name: str,
    schema_name: str,
    table_name: str,
    columns: List[CatalogObject],
    comment: Optional[str] = None,
) -> str:
    parts = [f"Table: {schema_name}.{table_name}", f"Catalog: {catalog_name}"]
    if comment:
        parts.append(f"Description: {comment}")
    pk = [c.column_name for c in columns if c.is_primary_key]
    if pk:
        parts.append(f"Primary Key: {', '.join(pk)}")
    fk = [c.column_name for c in columns if c.is_foreign_key]
    if fk:
        parts.append(f"Foreign Keys: {', '.join(fk)}")
    parts.append("Columns:")
    for c in columns:
        col = f"  - {c.column_name} ({c.data_type})"
        if not c.is_nullable:
            col += " NOT NULL"
        if c.comment:
            col += f" -- {c.comment}"
        parts.append(col)
    return "\n".join(parts)


def create_note_chunk(note: Note) -> str:
    parts = [f"Note: {note.title}", f"Content: {note.content}"]
    if note.tags:
        parts.append(f"Tags: {', '.join(note.tags)}")
    return "\n".join(parts)


def create_metric_chunk(metric: Metric) -> str:
    parts = [
        f"Metric: {metric.name}",
        f"Description: {metric.description}",
        f"Expression: {metric.expression}",
    ]
    if metric.engine:
        parts.append(f"Engine: {metric.engine}")
    if metric.tags:
        parts.append(f"Tags: {', '.join(metric.tags)}")
    return "\n".join(parts)


def create_example_chunk(example: Example) -> str:
    parts = [
        f"Example: {example.title}",
        f"Description: {example.description}",
        f"Engine: {example.engine}",
        f"SQL: {example.sql_snippet}",
    ]
    if example.tags:
        parts.append(f"Tags: {', '.join(example.tags)}")
    return "\n".join(parts)


def create_correction_chunk(correction: Correction) -> str:
    parts = [
        "User Correction",
        f"Question: {correction.question}",
        f"Correct SQL: {correction.correct_sql}",
    ]
    if correction.notes:
        parts.append(f"Issue / Rule: {correction.notes}")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Chunk builders — return (kind, fk_field, fk_id, content, metadata)
# ---------------------------------------------------------------------------

_FK_FIELD_BY_KIND = {
    "object":     "object_id",
    "note":       "note_id",
    "metric":     "metric_id",
    "example":    "example_id",
    "correction": "correction_id",
}


async def _build_object_chunks(
    db: AsyncSession,
    catalog: Catalog,
) -> List[Tuple[str, str, uuid.UUID, str, Dict[str, Any]]]:
    """Build one chunk per (schema, table) with attached columns."""
    stmt = select(CatalogObject).where(CatalogObject.catalog_id == catalog.id)
    rows = (await db.execute(stmt)).scalars().all()

    tables: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for obj in rows:
        if obj.object_type == "table":
            key = (obj.schema_name, obj.table_name)
            tables.setdefault(key, {"table": None, "columns": []})["table"] = obj
        elif obj.object_type == "column":
            key = (obj.schema_name, obj.table_name)
            tables.setdefault(key, {"table": None, "columns": []})["columns"].append(obj)

    out: List[Tuple[str, str, uuid.UUID, str, Dict[str, Any]]] = []
    for (schema_name, table_name), bundle in tables.items():
        table_obj: Optional[CatalogObject] = bundle["table"]
        if table_obj is None or not bundle["columns"]:
            continue
        content = create_table_chunk(
            catalog.catalog_name,
            schema_name,
            table_name,
            bundle["columns"],
            table_obj.comment,
        )
        metadata = {
            "schema": schema_name,
            "table": table_name,
            "object_type": "table",
        }
        out.append(("object", "object_id", table_obj.id, content, metadata))
    return out


async def _build_knowledge_chunks(
    db: AsyncSession,
    catalog_id: uuid.UUID,
) -> List[Tuple[str, str, uuid.UUID, str, Dict[str, Any]]]:
    """Approved notes/metrics/examples bound to this catalog *or* sector-global."""
    out: List[Tuple[str, str, uuid.UUID, str, Dict[str, Any]]] = []

    # Notes — catalog-bound or sector-global.
    notes = (await db.execute(
        select(Note).where(
            Note.status == "approved",
            or_(Note.catalog_id == catalog_id, Note.catalog_id.is_(None)),
        )
    )).scalars().all()
    for n in notes:
        out.append((
            "note", "note_id", n.id,
            create_note_chunk(n),
            {"title": n.title},
        ))

    # Metrics — same scoping rule.
    metrics = (await db.execute(
        select(Metric).where(
            Metric.status == "approved",
            or_(Metric.catalog_id == catalog_id, Metric.catalog_id.is_(None)),
        )
    )).scalars().all()
    for m in metrics:
        out.append((
            "metric", "metric_id", m.id,
            create_metric_chunk(m),
            {"name": m.name, "engine": m.engine},
        ))

    # Examples — same scoping rule.
    examples = (await db.execute(
        select(Example).where(
            Example.status == "approved",
            or_(Example.catalog_id == catalog_id, Example.catalog_id.is_(None)),
        )
    )).scalars().all()
    for e in examples:
        out.append((
            "example", "example_id", e.id,
            create_example_chunk(e),
            {"title": e.title, "engine": e.engine},
        ))

    return out


async def _build_correction_chunks(
    db: AsyncSession,
    catalog_id: uuid.UUID,
) -> List[Tuple[str, str, uuid.UUID, str, Dict[str, Any]]]:
    """Approved Corrections for this catalog. Pending/rejected never embedded."""
    stmt = select(Correction).where(
        Correction.catalog_id == catalog_id,
        Correction.status == "approved",
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        (
            "correction", "correction_id", c.id,
            create_correction_chunk(c),
            {"history_id": str(c.history_id)},
        )
        for c in rows
    ]


# ---------------------------------------------------------------------------
# Main: (re)build embeddings for a catalog
# ---------------------------------------------------------------------------

async def create_embeddings_for_catalog(
    db: AsyncSession,
    catalog_id: uuid.UUID,
    force: bool = False,
) -> Tuple[int, int]:
    """
    Build (or rebuild) Postgres + Qdrant embeddings for a catalog.

    Two-phase commit:
      1. Mutate Postgres state (flush, not commit).
      2. Upsert to Qdrant.
      3. Commit Postgres.

    On Qdrant failure, rollback Postgres and best-effort-delete any
    Qdrant points already written.

    Returns:
        (created_count, updated_count)
    """
    logger.info("embeddings.start", catalog_id=str(catalog_id), force=force)

    catalog = (
        await db.execute(select(Catalog).where(Catalog.id == catalog_id))
    ).scalar_one_or_none()
    if catalog is None:
        raise ValueError(f"Catalog {catalog_id} not found")

    sector_id = catalog.sector_id
    embed_model = await _resolve_active_embed_model()

    # ---- Force-rebuild path ----
    if force:
        try:
            await db.execute(delete(Embedding).where(Embedding.catalog_id == catalog_id))
            await qdrant_store.delete_by_catalog(
                sector_id=sector_id, catalog_id=catalog_id
            )
            await db.commit()
            logger.info("embeddings.force_clear_ok", catalog_id=str(catalog_id))
        except Exception as exc:
            await db.rollback()
            logger.error(
                "embeddings.force_clear_failed",
                error=str(exc),
                catalog_id=str(catalog_id),
            )
            raise

    # Always clean up rejected/orphaned embeddings before reindexing.
    await cleanup_rejected_embeddings(db, catalog_id)

    # ---- Build chunk set ----
    chunks: List[Tuple[str, str, uuid.UUID, str, Dict[str, Any]]] = []
    chunks.extend(await _build_object_chunks(db, catalog))
    chunks.extend(await _build_knowledge_chunks(db, catalog_id))
    chunks.extend(await _build_correction_chunks(db, catalog_id))

    if not chunks:
        logger.warning("embeddings.no_chunks", catalog_id=str(catalog_id))
        return 0, 0

    # ---- Embed ----
    contents = [c[3] for c in chunks]
    vectors = await generate_embeddings(contents, model=embed_model)
    if len(vectors) != len(chunks):
        raise ValueError(
            f"Embedding count mismatch: {len(vectors)} vectors for {len(chunks)} chunks"
        )

    # ---- Upsert into Postgres (flush only — commit after Qdrant succeeds) ----
    created = 0
    updated = 0
    qdrant_payload: List[Tuple[uuid.UUID, List[float], Dict[str, Any]]] = []

    try:
        for (kind, fk_field, fk_id, content, meta), vector in zip(chunks, vectors):
            existing = (await db.execute(
                select(Embedding).where(
                    Embedding.kind == kind,
                    getattr(Embedding, fk_field) == fk_id,
                )
            )).scalar_one_or_none()

            if existing is not None:
                existing.content = content
                existing.embedding_metadata = meta
                existing.sector_id = sector_id
                existing.catalog_id = catalog_id
                existing.embed_model = embed_model
                emb_id = existing.id
                updated += 1
            else:
                row = Embedding(
                    content=content,
                    kind=kind,
                    sector_id=sector_id,
                    catalog_id=catalog_id,
                    embed_model=embed_model,
                    embedding_metadata=meta,
                )
                setattr(row, fk_field, fk_id)
                db.add(row)
                await db.flush()
                emb_id = row.id
                created += 1

            qdrant_payload.append((
                emb_id,
                vector,
                {
                    "sector_id":   str(sector_id),
                    "catalog_id":  str(catalog_id),
                    "kind":        kind,
                    "embed_model": embed_model,
                    "metadata":    meta,
                },
            ))

        # ---- Qdrant upsert ----
        await qdrant_store.upsert_embeddings_batch(qdrant_payload)
        await db.commit()
        logger.info(
            "embeddings.committed",
            catalog_id=str(catalog_id),
            sector_id=str(sector_id),
            embed_model=embed_model,
            created=created,
            updated=updated,
        )
        return created, updated

    except Exception as exc:
        logger.error(
            "embeddings.failed_rolling_back",
            catalog_id=str(catalog_id),
            error=str(exc),
        )
        await db.rollback()
        # Best-effort Qdrant cleanup for any points already written.
        if qdrant_payload:
            try:
                await qdrant_store.delete_batch([p[0] for p in qdrant_payload])
                logger.info("embeddings.qdrant_cleaned_after_rollback",
                            count=len(qdrant_payload))
            except Exception as cleanup_exc:
                logger.error("embeddings.qdrant_cleanup_failed",
                             error=str(cleanup_exc))
        raise


# ---------------------------------------------------------------------------
# Cleanup: drop embeddings for rejected knowledge / corrections
# ---------------------------------------------------------------------------

async def cleanup_rejected_embeddings(
    db: AsyncSession,
    catalog_id: uuid.UUID,
) -> int:
    """
    Remove embeddings whose source knowledge or correction is no longer
    `approved` (rejected, reverted to pending, or hard-deleted).

    Uses concrete FK columns — one query per kind, then one batched Qdrant
    delete.
    """
    logger.info("embeddings.cleanup_start", catalog_id=str(catalog_id))

    to_delete_ids: List[uuid.UUID] = []

    # Collect Embedding IDs whose owning row is no longer approved.
    rejection_queries = [
        # Notes
        select(Embedding.id)
        .join(Note, Embedding.note_id == Note.id)
        .where(Embedding.catalog_id == catalog_id, Note.status != "approved"),
        # Metrics
        select(Embedding.id)
        .join(Metric, Embedding.metric_id == Metric.id)
        .where(Embedding.catalog_id == catalog_id, Metric.status != "approved"),
        # Examples
        select(Embedding.id)
        .join(Example, Embedding.example_id == Example.id)
        .where(Embedding.catalog_id == catalog_id, Example.status != "approved"),
        # Corrections
        select(Embedding.id)
        .join(Correction, Embedding.correction_id == Correction.id)
        .where(Embedding.catalog_id == catalog_id, Correction.status != "approved"),
    ]
    for q in rejection_queries:
        rows = (await db.execute(q)).scalars().all()
        to_delete_ids.extend(rows)

    if not to_delete_ids:
        logger.info("embeddings.cleanup_nothing_to_do", catalog_id=str(catalog_id))
        return 0

    try:
        await db.execute(delete(Embedding).where(Embedding.id.in_(to_delete_ids)))
        await qdrant_store.delete_batch(to_delete_ids)
        await db.commit()
        logger.info("embeddings.cleanup_committed",
                    catalog_id=str(catalog_id), deleted=len(to_delete_ids))
        return len(to_delete_ids)
    except Exception as exc:
        logger.error("embeddings.cleanup_failed",
                     catalog_id=str(catalog_id), error=str(exc))
        await db.rollback()
        raise


# ---------------------------------------------------------------------------
# Single-row embedding helpers — used by approve-on-write paths
# ---------------------------------------------------------------------------

async def embed_one_knowledge_row(
    db: AsyncSession,
    *,
    kind: str,
    row: Any,
) -> Optional[uuid.UUID]:
    """
    Embed (or re-embed) a single approved knowledge / correction row.

    Used by approval handlers to make a single newly-approved item searchable
    immediately, without a full catalog reindex.

    Returns the Embedding.id, or None if the row's status isn't 'approved'.
    """
    if kind not in _FK_FIELD_BY_KIND or kind == "object":
        raise ValueError(f"embed_one_knowledge_row: unsupported kind {kind!r}")

    status = getattr(row, "status", None)
    if status != "approved":
        return None

    sector_id: uuid.UUID = row.sector_id
    catalog_id: Optional[uuid.UUID] = getattr(row, "catalog_id", None)
    embed_model = await _resolve_active_embed_model()

    if kind == "note":
        content = create_note_chunk(row)
        meta = {"title": row.title}
    elif kind == "metric":
        content = create_metric_chunk(row)
        meta = {"name": row.name, "engine": row.engine}
    elif kind == "example":
        content = create_example_chunk(row)
        meta = {"title": row.title, "engine": row.engine}
    elif kind == "correction":
        content = create_correction_chunk(row)
        meta = {"history_id": str(row.history_id)}
    else:  # pragma: no cover
        raise AssertionError(f"unreachable kind {kind!r}")

    fk_field = _FK_FIELD_BY_KIND[kind]

    # Upsert by (kind, fk).
    existing = (await db.execute(
        select(Embedding).where(
            Embedding.kind == kind,
            getattr(Embedding, fk_field) == row.id,
        )
    )).scalar_one_or_none()

    [vector] = await generate_embeddings([content], model=embed_model)

    try:
        if existing is not None:
            existing.content = content
            existing.embedding_metadata = meta
            existing.sector_id = sector_id
            existing.catalog_id = catalog_id
            existing.embed_model = embed_model
            emb_id = existing.id
        else:
            new_row = Embedding(
                content=content,
                kind=kind,
                sector_id=sector_id,
                catalog_id=catalog_id,
                embed_model=embed_model,
                embedding_metadata=meta,
            )
            setattr(new_row, fk_field, row.id)
            db.add(new_row)
            await db.flush()
            emb_id = new_row.id

        await qdrant_store.upsert_embedding(
            embedding_id=emb_id,
            vector=vector,
            payload={
                "sector_id":   str(sector_id),
                "catalog_id":  str(catalog_id) if catalog_id else None,
                "kind":        kind,
                "embed_model": embed_model,
                "metadata":    meta,
            },
        )
        await db.commit()
        return emb_id
    except Exception as exc:
        await db.rollback()
        logger.error(
            "embeddings.embed_one_failed",
            kind=kind, row_id=str(row.id), error=str(exc),
        )
        raise


async def delete_embeddings_for_row(
    db: AsyncSession,
    *,
    kind: str,
    row_id: uuid.UUID,
) -> int:
    """Delete every Embedding pointing at `row_id` for `kind` (PG + Qdrant)."""
    if kind not in _FK_FIELD_BY_KIND:
        raise ValueError(f"delete_embeddings_for_row: unsupported kind {kind!r}")
    fk_field = _FK_FIELD_BY_KIND[kind]

    ids = (await db.execute(
        select(Embedding.id).where(getattr(Embedding, fk_field) == row_id)
    )).scalars().all()
    if not ids:
        return 0

    try:
        await db.execute(delete(Embedding).where(Embedding.id.in_(ids)))
        await qdrant_store.delete_batch(ids)
        await db.commit()
        return len(ids)
    except Exception:
        await db.rollback()
        raise
