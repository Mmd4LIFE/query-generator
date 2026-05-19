"""
History router — Phase 2, sector-scoped.

Mounted at `/v1/sectors/{sector_id}/history`. Visibility rules:

- **Soldier / Captain** see only their own rows.
- **Colonel / General** see every row in the Sector (audit view).

Pre-Phase-2 the legacy `/v1/history` endpoint trusted `user_id == self` only,
so a soldier in Sector A could not see Sector B (no IDOR), but a Colonel had
no way to audit the Sector. Both gaps are closed here.

Feedback writes always belong to the row's owner (`user_id == self`). The
"view all feedback for a row" path is Colonel+ — useful when reviewing why
a generation was rated badly across multiple sessions.

The legacy auto-reindex shortcut is gone; feedback with `suggested_sql`
files a pending `Correction` via `routers/corrections.file_pending_correction`
(see ROADMAP §Phase-5).
"""
from __future__ import annotations

import uuid
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import (
    ROLE_PRIORITY,
    SectorContext,
    current_sector,
    require_sector_soldier,
    User,
)
from app.deps.db import get_db
from app.models.auth import User as UserModel
from app.models.catalog import Catalog
from app.models.history import QueryFeedback, QueryHistory
from app.routers.corrections import file_pending_correction

logger = structlog.get_logger()
router = APIRouter()


def _can_see_whole_sector(role: str) -> bool:
    """Colonel and above see every row in the Sector."""
    return ROLE_PRIORITY.get(role, 0) >= ROLE_PRIORITY["colonel"]


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class HistoryResponse(BaseModel):
    id: uuid.UUID
    sector_id: uuid.UUID
    catalog_id: uuid.UUID
    engine: str
    question: str
    generated_sql: Optional[str]
    explanation: Optional[str]
    syntax_valid: Optional[bool]
    status: str
    generation_time_ms: Optional[float]
    created_at: str
    tokens_used: Optional[int]
    cost_usd: Optional[float] = None
    model_used: Optional[str] = None
    catalog_name: Optional[str] = None
    user_id: uuid.UUID
    username: Optional[str] = None

    class Config:
        from_attributes = True


class HistoryList(BaseModel):
    items: List[HistoryResponse]
    total: int
    limit: int
    offset: int


class FeedbackCreate(BaseModel):
    rating: Optional[int] = Field(None, ge=1, le=5)
    comment: Optional[str] = None
    correctness: Optional[int] = Field(None, ge=1, le=5)
    completeness: Optional[int] = Field(None, ge=1, le=5)
    efficiency: Optional[int] = Field(None, ge=1, le=5)
    suggested_sql: Optional[str] = None
    improvement_notes: Optional[str] = None


class FeedbackResponse(BaseModel):
    id: uuid.UUID
    history_id: uuid.UUID
    rating: Optional[int]
    comment: Optional[str]
    correctness: Optional[int]
    completeness: Optional[int]
    efficiency: Optional[int]
    suggested_sql: Optional[str]
    improvement_notes: Optional[str]
    correction_status: Optional[str]
    created_at: str
    username: Optional[str] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _fetch_history_for_caller(
    db: AsyncSession,
    *,
    history_id: uuid.UUID,
    sector_id: uuid.UUID,
    caller: User,
    caller_role: str,
    own_only: bool = False,
) -> QueryHistory:
    """Load a history row, enforcing sector scope and the visibility rule.

    `own_only=True` ignores the Colonel exemption — used by feedback write
    paths where the actor must be the row's owner regardless of tier.

    404 on miss (not 403) to avoid existence leakage across sectors.
    """
    stmt = select(QueryHistory).where(
        QueryHistory.id == history_id,
        QueryHistory.sector_id == sector_id,
    )
    if own_only or not _can_see_whole_sector(caller_role):
        stmt = stmt.where(QueryHistory.user_id == caller.id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History item not found",
        )
    return row


def _to_response(
    row: QueryHistory,
    catalog_name: Optional[str],
    username: Optional[str],
) -> HistoryResponse:
    return HistoryResponse(
        id=row.id,
        sector_id=row.sector_id,
        catalog_id=row.catalog_id,
        engine=row.engine,
        question=row.question,
        generated_sql=row.generated_sql,
        explanation=row.explanation,
        syntax_valid=row.syntax_valid,
        status=row.status,
        generation_time_ms=row.generation_time_ms,
        created_at=row.created_at.isoformat(),
        tokens_used=row.total_tokens,
        cost_usd=row.cost_usd,
        model_used=row.model_used,
        catalog_name=catalog_name,
        user_id=row.user_id,
        username=username,
    )


def _to_feedback(fb: QueryFeedback, username: Optional[str]) -> FeedbackResponse:
    return FeedbackResponse(
        id=fb.id,
        history_id=fb.history_id,
        rating=fb.rating,
        comment=fb.comment,
        correctness=fb.correctness,
        completeness=fb.completeness,
        efficiency=fb.efficiency,
        suggested_sql=fb.suggested_sql,
        improvement_notes=fb.improvement_notes,
        correction_status=fb.correction_status,
        created_at=fb.created_at.isoformat(),
        username=username,
    )


# ---------------------------------------------------------------------------
# List + read
# ---------------------------------------------------------------------------

@router.get("", response_model=HistoryList)
async def get_history(
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    caller: User = Depends(require_sector_soldier),
    catalog_id: Optional[uuid.UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    scope: str = Query(
        default="auto",
        description=(
            "auto=role-default (Soldier/Captain see own, Colonel+ see whole "
            "Sector). own=force own only. sector=force whole Sector (Colonel+ "
            "only, else 403)."
        ),
    ),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> HistoryList:
    sector_id = sector.sector.id
    elevated = _can_see_whole_sector(sector.role)

    if scope == "sector" and not elevated:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Colonel+ required to view Sector-wide history",
        )

    see_all = elevated if scope == "auto" else (scope == "sector")

    base = (
        select(QueryHistory, Catalog.catalog_name, UserModel.username)
        .join(Catalog, QueryHistory.catalog_id == Catalog.id)
        .join(UserModel, QueryHistory.user_id == UserModel.id)
        .where(QueryHistory.sector_id == sector_id)
    )
    count_base = select(func.count(QueryHistory.id)).where(
        QueryHistory.sector_id == sector_id
    )

    if not see_all:
        base = base.where(QueryHistory.user_id == caller.id)
        count_base = count_base.where(QueryHistory.user_id == caller.id)

    if catalog_id:
        base = base.where(QueryHistory.catalog_id == catalog_id)
        count_base = count_base.where(QueryHistory.catalog_id == catalog_id)

    if status_filter:
        base = base.where(QueryHistory.status == status_filter)
        count_base = count_base.where(QueryHistory.status == status_filter)

    total = (await db.execute(count_base)).scalar_one()
    rows = (await db.execute(
        base.order_by(desc(QueryHistory.created_at)).limit(limit).offset(offset)
    )).all()

    return HistoryList(
        items=[_to_response(h, cat_name, uname) for h, cat_name, uname in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{history_id}", response_model=HistoryResponse)
async def get_history_item(
    history_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    caller: User = Depends(require_sector_soldier),
) -> HistoryResponse:
    row = await _fetch_history_for_caller(
        db,
        history_id=history_id,
        sector_id=sector.sector.id,
        caller=caller,
        caller_role=sector.role,
    )
    cat_name = (await db.execute(
        select(Catalog.catalog_name).where(Catalog.id == row.catalog_id)
    )).scalar_one_or_none()
    uname = (await db.execute(
        select(UserModel.username).where(UserModel.id == row.user_id)
    )).scalar_one_or_none()
    return _to_response(row, cat_name, uname)


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

@router.post("/{history_id}/feedback", response_model=FeedbackResponse)
async def create_feedback(
    history_id: uuid.UUID,
    body: FeedbackCreate,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    caller: User = Depends(require_sector_soldier),
) -> FeedbackResponse:
    """Create or update feedback. Must be the row owner — Colonels review
    via the corrections queue, not by leaving their own feedback."""
    history = await _fetch_history_for_caller(
        db,
        history_id=history_id,
        sector_id=sector.sector.id,
        caller=caller,
        caller_role=sector.role,
        own_only=True,
    )

    existing = (await db.execute(
        select(QueryFeedback).where(
            QueryFeedback.history_id == history_id,
            QueryFeedback.user_id == caller.id,
        )
    )).scalar_one_or_none()

    if existing is not None:
        for field in (
            "rating", "comment", "correctness",
            "completeness", "efficiency",
            "suggested_sql", "improvement_notes",
        ):
            val = getattr(body, field)
            if val is not None:
                setattr(existing, field, val)
        feedback = existing
    else:
        feedback = QueryFeedback(
            sector_id=sector.sector.id,
            history_id=history_id,
            user_id=caller.id,
            rating=body.rating,
            comment=body.comment,
            correctness=body.correctness,
            completeness=body.completeness,
            efficiency=body.efficiency,
            suggested_sql=body.suggested_sql,
            improvement_notes=body.improvement_notes,
        )
        db.add(feedback)

    await db.flush()

    # File a pending Correction so a Colonel can review and approve. The
    # soldier's SQL is NEVER embedded until that approval lands.
    if feedback.suggested_sql:
        try:
            await file_pending_correction(db, feedback=feedback, history=history)
            feedback.correction_status = "pending"
        except Exception as exc:
            logger.error(
                "feedback.file_correction_failed",
                history_id=str(history_id),
                error=str(exc),
            )

    await db.commit()
    await db.refresh(feedback)

    return _to_feedback(feedback, caller.username)


@router.get("/{history_id}/feedback", response_model=FeedbackResponse)
async def get_own_feedback(
    history_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    caller: User = Depends(require_sector_soldier),
) -> FeedbackResponse:
    # Confirm the row exists & is in scope; ownership enforced on the feedback row.
    await _fetch_history_for_caller(
        db,
        history_id=history_id,
        sector_id=sector.sector.id,
        caller=caller,
        caller_role=sector.role,
    )
    fb = (await db.execute(
        select(QueryFeedback).where(
            QueryFeedback.history_id == history_id,
            QueryFeedback.user_id == caller.id,
        )
    )).scalar_one_or_none()
    if fb is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feedback not found",
        )
    return _to_feedback(fb, caller.username)


@router.get("/{history_id}/feedback/all", response_model=List[FeedbackResponse])
async def get_all_feedback(
    history_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    caller: User = Depends(require_sector_soldier),
) -> List[FeedbackResponse]:
    """List every feedback row on a history item. Colonel+ only — Soldier/
    Captain can only see their own via `GET /feedback`."""
    if not _can_see_whole_sector(sector.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Colonel+ required to view other users' feedback",
        )

    # Confirm the parent row is in this sector (404 otherwise).
    await _fetch_history_for_caller(
        db,
        history_id=history_id,
        sector_id=sector.sector.id,
        caller=caller,
        caller_role=sector.role,
    )

    rows = (await db.execute(
        select(QueryFeedback, UserModel.username)
        .join(UserModel, QueryFeedback.user_id == UserModel.id)
        .where(QueryFeedback.history_id == history_id)
        .order_by(desc(QueryFeedback.created_at))
    )).all()

    return [_to_feedback(fb, uname) for fb, uname in rows]
