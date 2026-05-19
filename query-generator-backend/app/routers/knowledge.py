"""
Knowledge router — Phase 2, sector-scoped.

Mounted at `/v1/sectors/{sector_id}/knowledge/{notes|metrics|examples}`.

Tier matrix
-----------
- **Soldier+** reads notes / metrics / examples in their Sector.
- **Captain+** creates and updates pending items.
- **Colonel+** approves or rejects. The integrity rule
  ``approved_by != created_by`` is enforced **here, not at the DB layer**,
  because the DB cannot see the auth principal. Generals are **not**
  exempt — self-approval is a correctness rule, not a permission one
  (same as `routers/corrections.py`).

Per-row embedding
-----------------
Approval calls `embed_one_knowledge_row` so only the affected row goes
through the embedder — no more whole-catalog reindex on every edit.
Rejection of a previously-approved row drops its embedding via
`delete_embeddings_for_row`.

If the underlying knowledge row is not catalog-bound (`catalog_id IS
NULL` — sector-global), embedding is currently a no-op. The retrieval
path filters by `catalog_id`, so sector-global knowledge is not surfaced
yet; bridging that is a Phase-4 follow-up (see ROADMAP §6).
"""
from __future__ import annotations

import uuid
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.embeddings import (
    delete_embeddings_for_row,
    embed_one_knowledge_row,
)
from app.deps.auth import (
    SectorContext,
    current_sector,
    require_sector_captain,
    require_sector_colonel,
    require_sector_soldier,
    User,
)
from app.deps.db import get_db
from app.models.catalog import Catalog
from app.models.knowledge import Example, Metric, Note
from app.schemas.knowledge import (
    ApprovalRequest,
    ApprovalResponse,
    Example as ExampleSchema,
    ExampleCreate,
    Metric as MetricSchema,
    MetricCreate,
    Note as NoteSchema,
    NoteCreate,
)

logger = structlog.get_logger()
router = APIRouter()


# ---------------------------------------------------------------------------
# Generic helpers — work across all three knowledge models
# ---------------------------------------------------------------------------

async def _check_catalog_in_sector(
    db: AsyncSession,
    *,
    catalog_id: Optional[uuid.UUID],
    sector_id: uuid.UUID,
) -> None:
    """Reject any cross-sector catalog reference at the API edge.

    Knowledge rows can be sector-global (`catalog_id IS NULL`) — that's fine.
    When a catalog_id IS supplied, it must belong to this Sector.
    """
    if catalog_id is None:
        return
    found = (await db.execute(
        select(Catalog.id).where(
            Catalog.id == catalog_id, Catalog.sector_id == sector_id
        )
    )).scalar_one_or_none()
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="catalog_id does not belong to this Sector",
        )


def _kind_for_model(model_cls) -> str:
    return {Note: "note", Metric: "metric", Example: "example"}[model_cls]


async def _approve_or_reject_row(
    db: AsyncSession,
    *,
    row,
    action: str,             # "approve" or "reject"
    actor: User,
    sector_id: uuid.UUID,
) -> None:
    """Shared approve/reject mechanics: integrity check, status, embedding,
    audit. Caller must `await db.commit()` and `await db.refresh(row)` after."""
    if action == "approve":
        if row.created_by == actor.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Approver must differ from creator",
            )

        prev_status = row.status
        row.status = "approved"
        row.approved_by = actor.id
        kind = _kind_for_model(type(row))

        # Embed (or re-embed) this single row. Embedding failure is fatal:
        # we cannot honestly say "approved" if retrieval won't see it.
        try:
            await embed_one_knowledge_row(db, kind=kind, row=row)
        except Exception as exc:
            logger.error(
                "knowledge.approve.embed_failed",
                kind=kind,
                row_id=str(row.id),
                error=str(exc),
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Embedding service unavailable — try again",
            )

        write_audit(
            db,
            actor_id=actor.id,
            sector_id=sector_id,
            action=f"{kind}.approve",
            target_type=kind,
            target_id=row.id,
            diff={"before": {"status": prev_status},
                  "after": {"status": "approved", "approved_by": str(actor.id)}},
        )

    elif action == "reject":
        prev_status = row.status
        row.status = "rejected"
        row.approved_by = None
        kind = _kind_for_model(type(row))

        # Cleanup: if we're rejecting something that was previously
        # approved, drop its embedding. Best-effort — if the cleanup
        # fails, the next reindex will still remove the orphan because
        # `cleanup_rejected_embeddings` filters by status != 'approved'.
        if prev_status == "approved":
            try:
                await delete_embeddings_for_row(db, kind=kind, row_id=row.id)
            except Exception as exc:
                logger.error(
                    "knowledge.reject.cleanup_failed",
                    kind=kind, row_id=str(row.id), error=str(exc),
                )

        write_audit(
            db,
            actor_id=actor.id,
            sector_id=sector_id,
            action=f"{kind}.reject",
            target_type=kind,
            target_id=row.id,
            diff={"before": {"status": prev_status},
                  "after": {"status": "rejected"}},
        )
    else:
        # Should be unreachable — schema validates this.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid action {action!r}",
        )


# ---------------------------------------------------------------------------
# NOTES
# ---------------------------------------------------------------------------

@router.post("/notes", response_model=NoteSchema)
async def create_note(
    body: NoteCreate,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_sector_captain),
):
    """Create a pending note. Approval is a separate Colonel+ step."""
    sector_id = sector.sector.id
    await _check_catalog_in_sector(
        db, catalog_id=body.catalog_id, sector_id=sector_id
    )

    note = Note(
        sector_id=sector_id,
        title=body.title,
        content=body.content,
        tags=body.tags,
        catalog_id=body.catalog_id,
        created_by=actor.id,
        status="pending",
    )
    db.add(note)
    await db.flush()

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector_id,
        action="note.create",
        target_type="note",
        target_id=note.id,
        diff={"after": {"title": note.title, "catalog_id": str(note.catalog_id) if note.catalog_id else None}},
    )
    await db.commit()
    await db.refresh(note)
    return note


@router.get("/notes", response_model=List[NoteSchema])
async def list_notes(
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_sector_soldier),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    catalog_id: Optional[uuid.UUID] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    stmt = select(Note).where(Note.sector_id == sector.sector.id)
    if status_filter:
        stmt = stmt.where(Note.status == status_filter)
    if catalog_id:
        stmt = stmt.where(Note.catalog_id == catalog_id)
    rows = (await db.execute(
        stmt.order_by(desc(Note.created_at)).limit(limit).offset(offset)
    )).scalars().all()
    return rows


@router.get("/notes/{note_id}", response_model=NoteSchema)
async def get_note(
    note_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_sector_soldier),
):
    row = (await db.execute(
        select(Note).where(
            Note.id == note_id, Note.sector_id == sector.sector.id
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    return row


@router.post("/notes/{note_id}/approve", response_model=ApprovalResponse)
async def approve_note(
    note_id: uuid.UUID,
    body: ApprovalRequest,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_sector_colonel),
):
    note = (await db.execute(
        select(Note).where(
            Note.id == note_id, Note.sector_id == sector.sector.id
        )
    )).scalar_one_or_none()
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")

    await _approve_or_reject_row(
        db, row=note, action=body.action, actor=actor, sector_id=sector.sector.id
    )
    await db.commit()
    await db.refresh(note)
    return ApprovalResponse(
        id=note.id,
        status=note.status,
        approved_by=note.approved_by,
        updated_at=note.updated_at,
    )


# ---------------------------------------------------------------------------
# METRICS
# ---------------------------------------------------------------------------

@router.post("/metrics", response_model=MetricSchema)
async def create_metric(
    body: MetricCreate,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_sector_captain),
):
    sector_id = sector.sector.id
    await _check_catalog_in_sector(
        db, catalog_id=body.catalog_id, sector_id=sector_id
    )

    metric = Metric(
        sector_id=sector_id,
        name=body.name,
        description=body.description,
        expression=body.expression,
        engine=body.engine,
        tags=body.tags,
        catalog_id=body.catalog_id,
        metric_metadata=body.metric_metadata,
        created_by=actor.id,
        status="pending",
    )
    db.add(metric)
    await db.flush()

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector_id,
        action="metric.create",
        target_type="metric",
        target_id=metric.id,
        diff={"after": {"name": metric.name, "engine": metric.engine}},
    )
    await db.commit()
    await db.refresh(metric)
    return metric


@router.get("/metrics", response_model=List[MetricSchema])
async def list_metrics(
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_sector_soldier),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    catalog_id: Optional[uuid.UUID] = None,
    engine: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    stmt = select(Metric).where(Metric.sector_id == sector.sector.id)
    if status_filter:
        stmt = stmt.where(Metric.status == status_filter)
    if catalog_id:
        stmt = stmt.where(Metric.catalog_id == catalog_id)
    if engine:
        stmt = stmt.where(Metric.engine == engine)
    rows = (await db.execute(
        stmt.order_by(desc(Metric.created_at)).limit(limit).offset(offset)
    )).scalars().all()
    return rows


@router.get("/metrics/{metric_id}", response_model=MetricSchema)
async def get_metric(
    metric_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_sector_soldier),
):
    row = (await db.execute(
        select(Metric).where(
            Metric.id == metric_id, Metric.sector_id == sector.sector.id
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Metric not found")
    return row


@router.post("/metrics/{metric_id}/approve", response_model=ApprovalResponse)
async def approve_metric(
    metric_id: uuid.UUID,
    body: ApprovalRequest,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_sector_colonel),
):
    metric = (await db.execute(
        select(Metric).where(
            Metric.id == metric_id, Metric.sector_id == sector.sector.id
        )
    )).scalar_one_or_none()
    if metric is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Metric not found")

    await _approve_or_reject_row(
        db, row=metric, action=body.action, actor=actor, sector_id=sector.sector.id
    )
    await db.commit()
    await db.refresh(metric)
    return ApprovalResponse(
        id=metric.id,
        status=metric.status,
        approved_by=metric.approved_by,
        updated_at=metric.updated_at,
    )


# ---------------------------------------------------------------------------
# EXAMPLES
# ---------------------------------------------------------------------------

@router.post("/examples", response_model=ExampleSchema)
async def create_example(
    body: ExampleCreate,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_sector_captain),
):
    sector_id = sector.sector.id
    await _check_catalog_in_sector(
        db, catalog_id=body.catalog_id, sector_id=sector_id
    )

    example = Example(
        sector_id=sector_id,
        title=body.title,
        description=body.description,
        sql_snippet=body.sql_snippet,
        engine=body.engine,
        tags=body.tags,
        catalog_id=body.catalog_id,
        example_metadata=body.example_metadata,
        created_by=actor.id,
        status="pending",
    )
    db.add(example)
    await db.flush()

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector_id,
        action="example.create",
        target_type="example",
        target_id=example.id,
        diff={"after": {"title": example.title, "engine": example.engine}},
    )
    await db.commit()
    await db.refresh(example)
    return example


@router.get("/examples", response_model=List[ExampleSchema])
async def list_examples(
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_sector_soldier),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    catalog_id: Optional[uuid.UUID] = None,
    engine: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    stmt = select(Example).where(Example.sector_id == sector.sector.id)
    if status_filter:
        stmt = stmt.where(Example.status == status_filter)
    if catalog_id:
        stmt = stmt.where(Example.catalog_id == catalog_id)
    if engine:
        stmt = stmt.where(Example.engine == engine)
    rows = (await db.execute(
        stmt.order_by(desc(Example.created_at)).limit(limit).offset(offset)
    )).scalars().all()
    return rows


@router.get("/examples/{example_id}", response_model=ExampleSchema)
async def get_example(
    example_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_sector_soldier),
):
    row = (await db.execute(
        select(Example).where(
            Example.id == example_id, Example.sector_id == sector.sector.id
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Example not found")
    return row


@router.post("/examples/{example_id}/approve", response_model=ApprovalResponse)
async def approve_example(
    example_id: uuid.UUID,
    body: ApprovalRequest,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_sector_colonel),
):
    example = (await db.execute(
        select(Example).where(
            Example.id == example_id, Example.sector_id == sector.sector.id
        )
    )).scalar_one_or_none()
    if example is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Example not found")

    await _approve_or_reject_row(
        db, row=example, action=body.action, actor=actor, sector_id=sector.sector.id
    )
    await db.commit()
    await db.refresh(example)
    return ApprovalResponse(
        id=example.id,
        status=example.status,
        approved_by=example.approved_by,
        updated_at=example.updated_at,
    )
