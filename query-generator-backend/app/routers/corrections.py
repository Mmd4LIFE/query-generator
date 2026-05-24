"""
Corrections router — Phase 5, the closed half of the feedback loop.

Lifecycle
=========
1. Soldier / Captain submits feedback with `suggested_sql` on a history row.
   The feedback router files a **pending** Correction here (see
   `_file_pending_correction` below). Nothing gets embedded yet.

2. Colonel opens `GET /v1/sectors/{sid}/corrections?status=pending` and
   reviews each.

3. Colonel approves → the Correction is stamped `status='approved'`,
   `approved_by` is set, and the row is **embedded as `kind='correction'`**
   (highest-priority context in retrieval). The integrity rule
   `approved_by != created_by` is enforced here, **even for Generals** —
   self-approval is a correctness bug, not a permission bug.

4. Colonel rejects → status `'rejected'`, no embedding ever generated.

Sector scope
============
Every route is mounted under `/v1/sectors/{sector_id}/corrections`, gated
by `current_sector` (membership check) and `require_sector_*` (tier check).
A Sector-A Colonel cannot see Sector-B's queue.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.embeddings import delete_embeddings_for_row, embed_one_knowledge_row
from app.deps.auth import (
    SectorContext,
    User,
    get_current_active_user,
    require_sector_colonel,
    require_sector_soldier,
)
from app.deps.db import get_db
from app.models.auth import User as UserModel
from app.models.correction import Correction
from app.models.history import QueryFeedback, QueryHistory

logger = structlog.get_logger()
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CorrectionOut(BaseModel):
    id: uuid.UUID
    sector_id: uuid.UUID
    catalog_id: uuid.UUID
    history_id: uuid.UUID
    question: str
    correct_sql: str
    notes: Optional[str]
    status: str
    created_by: uuid.UUID
    created_by_username: Optional[str] = None
    approved_by: Optional[uuid.UUID]
    approved_by_username: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CorrectionList(BaseModel):
    items: List[CorrectionOut]
    total: int


class RejectRequest(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------------
# Internal helper used by `routers/history.py` when feedback comes in
# ---------------------------------------------------------------------------

async def file_pending_correction(
    db: AsyncSession,
    *,
    feedback: QueryFeedback,
    history: QueryHistory,
) -> Optional[Correction]:
    """File a pending Correction from an actionable feedback row.

    No-op when there's no teachable signal (missing both `suggested_sql`
    and `improvement_notes`). Idempotent on (history_id, created_by) — a
    second feedback edit updates the existing pending row instead of
    spamming the queue.

    Caller must commit. Returns the (created or updated) Correction, or
    None when nothing was filed.
    """
    if not feedback.suggested_sql:
        return None

    existing = (await db.execute(
        select(Correction).where(
            Correction.history_id == history.id,
            Correction.created_by == feedback.user_id,
        )
    )).scalar_one_or_none()

    if existing is not None:
        # Don't resurrect an approved/rejected correction — Colonel already
        # ruled on it. Only refresh while still pending.
        if existing.status != "pending":
            return existing
        existing.correct_sql = feedback.suggested_sql
        existing.notes = feedback.improvement_notes
        existing.question = history.question
        return existing

    row = Correction(
        sector_id=history.sector_id,
        catalog_id=history.catalog_id,
        history_id=history.id,
        question=history.question,
        correct_sql=feedback.suggested_sql,
        notes=feedback.improvement_notes,
        status="pending",
        created_by=feedback.user_id,
    )
    db.add(row)
    return row


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

def _to_out(c: Correction, *, by_user: Optional[str], approved_user: Optional[str]) -> CorrectionOut:
    return CorrectionOut(
        id=c.id,
        sector_id=c.sector_id,
        catalog_id=c.catalog_id,
        history_id=c.history_id,
        question=c.question,
        correct_sql=c.correct_sql,
        notes=c.notes,
        status=c.status,
        created_by=c.created_by,
        created_by_username=by_user,
        approved_by=c.approved_by,
        approved_by_username=approved_user,
        created_at=c.created_at,
        updated_at=c.updated_at,
    )


@router.get("", response_model=CorrectionList)
async def list_corrections(
    *,
    sector: SectorContext = Depends(require_sector_soldier),
    db: AsyncSession = Depends(get_db),
    status_filter: Optional[str] = None,
    catalog_id: Optional[uuid.UUID] = None,
    limit: int = 50,
    offset: int = 0,
) -> CorrectionList:
    """List corrections in this Sector. Soldiers see all states for
    transparency; only Colonel+ can approve/reject."""
    base = select(Correction).where(Correction.sector_id == sector.sector.id)
    if status_filter:
        base = base.where(Correction.status == status_filter)
    if catalog_id:
        base = base.where(Correction.catalog_id == catalog_id)

    total = (await db.execute(
        select(func.count()).select_from(base.subquery())
    )).scalar_one()

    rows = (await db.execute(
        base.order_by(desc(Correction.created_at)).limit(limit).offset(offset)
    )).scalars().all()

    # Resolve usernames in one query.
    user_ids = {r.created_by for r in rows} | {
        r.approved_by for r in rows if r.approved_by is not None
    }
    usernames: dict[uuid.UUID, str] = {}
    if user_ids:
        u_rows = (await db.execute(
            select(UserModel.id, UserModel.username).where(UserModel.id.in_(user_ids))
        )).all()
        usernames = {uid: uname for uid, uname in u_rows}

    return CorrectionList(
        total=total,
        items=[
            _to_out(
                r,
                by_user=usernames.get(r.created_by),
                approved_user=usernames.get(r.approved_by) if r.approved_by else None,
            )
            for r in rows
        ],
    )


@router.get("/{correction_id}", response_model=CorrectionOut)
async def get_correction(
    correction_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(require_sector_soldier),
    db: AsyncSession = Depends(get_db),
) -> CorrectionOut:
    row = (await db.execute(
        select(Correction).where(
            Correction.id == correction_id,
            Correction.sector_id == sector.sector.id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Correction not found")

    creator_name = (await db.execute(
        select(UserModel.username).where(UserModel.id == row.created_by)
    )).scalar_one_or_none()
    approver_name = None
    if row.approved_by:
        approver_name = (await db.execute(
            select(UserModel.username).where(UserModel.id == row.approved_by)
        )).scalar_one_or_none()
    return _to_out(row, by_user=creator_name, approved_user=approver_name)


@router.post("/{correction_id}/approve", response_model=CorrectionOut)
async def approve_correction(
    correction_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(require_sector_colonel),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_active_user),
) -> CorrectionOut:
    """Approve a pending correction and embed it.

    Integrity rule: a user cannot approve their own correction — even a
    General. This is a correctness rule, not a permission rule.
    """
    row = (await db.execute(
        select(Correction).where(
            Correction.id == correction_id,
            Correction.sector_id == sector.sector.id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Correction not found")

    if row.status != "pending":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Correction is already {row.status!r}",
        )

    if row.created_by == actor.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Approver must differ from creator",
        )

    row.status = "approved"
    row.approved_by = actor.id
    await db.flush()

    # Embed immediately so the next retrieval surfaces it.
    try:
        await embed_one_knowledge_row(db, kind="correction", row=row)
    except Exception as exc:
        logger.error(
            "corrections.embed_failed_on_approve",
            correction_id=str(row.id),
            error=str(exc),
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Embedding service unavailable — try again",
        )

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector.sector.id,
        action="correction.approve",
        target_type="correction",
        target_id=row.id,
        diff={"after": {"status": "approved", "approved_by": str(actor.id)}},
    )
    await db.commit()
    await db.refresh(row)

    logger.info(
        "corrections.approved",
        correction_id=str(row.id),
        sector_id=str(sector.sector.id),
        approver=actor.username,
    )

    creator_name = (await db.execute(
        select(UserModel.username).where(UserModel.id == row.created_by)
    )).scalar_one_or_none()
    return _to_out(row, by_user=creator_name, approved_user=actor.username)


@router.post("/{correction_id}/reject", response_model=CorrectionOut)
async def reject_correction(
    correction_id: uuid.UUID,
    body: RejectRequest,
    *,
    sector: SectorContext = Depends(require_sector_colonel),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_active_user),
) -> CorrectionOut:
    """Reject a pending correction. Any prior embedding (shouldn't exist on
    a pending row, but defensive) is also removed."""
    row = (await db.execute(
        select(Correction).where(
            Correction.id == correction_id,
            Correction.sector_id == sector.sector.id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Correction not found")

    if row.status not in ("pending", "approved"):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"Correction is already {row.status!r}",
        )

    prev_status = row.status
    row.status = "rejected"
    row.approved_by = None
    if body.notes is not None:
        row.notes = body.notes

    # If we're un-approving an already-approved correction, drop its embedding.
    if prev_status == "approved":
        try:
            await delete_embeddings_for_row(db, kind="correction", row_id=row.id)
        except Exception as exc:
            logger.error(
                "corrections.delete_embedding_failed",
                correction_id=str(row.id),
                error=str(exc),
            )
            # Don't block the rejection on cleanup failure — the row is
            # marked rejected and the next reindex will drop the orphan.

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector.sector.id,
        action="correction.reject",
        target_type="correction",
        target_id=row.id,
        diff={"before": {"status": prev_status}, "after": {"status": "rejected"}},
    )
    await db.commit()
    await db.refresh(row)

    logger.info(
        "corrections.rejected",
        correction_id=str(row.id),
        sector_id=str(sector.sector.id),
        rejector=actor.username,
    )

    creator_name = (await db.execute(
        select(UserModel.username).where(UserModel.id == row.created_by)
    )).scalar_one_or_none()
    return _to_out(row, by_user=creator_name, approved_user=None)
