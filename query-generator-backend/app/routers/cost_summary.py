"""
Cost-summary router — aggregated usage / spend / token counts from
`dq_history`.

Two mount points:
  - `/v1/sectors/{sector_id}/cost-summary`   Colonel+ for that Sector.
  - `/v1/cost-summary`                       Generals only (cross-Sector).

The legacy `UserCostRow` type already exists on the frontend
(`lib/api-client.ts`) — this implements the server side.

All endpoints accept a `from`/`to` date range (`YYYY-MM-DD`) and a
`group_by` selector. Server caps the row count at 500 to avoid bloating
dashboards; group_by=day always returns full rows in range, but
group_by=user or model are top-N by total cost.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import case, cast, Date, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import (
    SectorContext,
    current_sector,
    require_general,
    require_sector_colonel,
    User,
)
from app.deps.db import get_db
from app.models.auth import User as UserModel
from app.models.history import QueryHistory
from app.models.sector import Sector

logger = structlog.get_logger()
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CostRow(BaseModel):
    key: str                       # day / username / model_name / sector_code
    label: Optional[str] = None    # human-friendly label (username, sector name, …)
    requests: int
    successes: int
    errors: int
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float


class CostSummary(BaseModel):
    group_by: str
    from_date: Optional[date]
    to_date: Optional[date]
    rows: List[CostRow]
    total: CostRow                 # grand total across the range


GroupBy = str   # 'day' | 'user' | 'model' | 'sector'


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------

def _coerce_range(
    from_date: Optional[date], to_date: Optional[date]
) -> tuple[Optional[datetime], Optional[datetime]]:
    """Turn dates into UTC datetime bounds; `to_date` is inclusive (end of day)."""
    from_dt = (
        datetime.combine(from_date, time.min, tzinfo=timezone.utc)
        if from_date else None
    )
    to_dt = (
        datetime.combine(to_date, time.max, tzinfo=timezone.utc)
        if to_date else None
    )
    return from_dt, to_dt


def _agg_columns():
    """The five aggregate expressions used by every group_by variant."""
    succ_case = case((QueryHistory.status == "success", 1), else_=0)
    err_case = case((QueryHistory.status == "error", 1), else_=0)
    return (
        func.count(QueryHistory.id).label("requests"),
        func.sum(succ_case).label("successes"),
        func.sum(err_case).label("errors"),
        func.coalesce(func.sum(QueryHistory.prompt_tokens), 0).label("prompt_tokens"),
        func.coalesce(func.sum(QueryHistory.completion_tokens), 0).label("completion_tokens"),
        func.coalesce(func.sum(QueryHistory.total_tokens), 0).label("total_tokens"),
        func.coalesce(func.sum(QueryHistory.cost_usd), 0.0).label("cost_usd"),
    )


async def _build_total(
    db: AsyncSession,
    base_filter,
    *,
    from_date: Optional[date],
    to_date: Optional[date],
) -> CostRow:
    """Grand-total row across the filter."""
    requests, successes, errors, ptok, ctok, ttok, cost = _agg_columns()
    stmt = select(requests, successes, errors, ptok, ctok, ttok, cost)
    stmt = base_filter(stmt)
    row = (await db.execute(stmt)).one()
    return CostRow(
        key="__total__",
        label="Total",
        requests=row.requests or 0,
        successes=row.successes or 0,
        errors=row.errors or 0,
        prompt_tokens=row.prompt_tokens or 0,
        completion_tokens=row.completion_tokens or 0,
        total_tokens=row.total_tokens or 0,
        cost_usd=float(row.cost_usd or 0.0),
    )


async def _grouped(
    db: AsyncSession,
    *,
    group_by: GroupBy,
    apply_filter,
    limit: int,
) -> List[CostRow]:
    requests, successes, errors, ptok, ctok, ttok, cost = _agg_columns()

    if group_by == "day":
        bucket = cast(QueryHistory.created_at, Date).label("bucket")
        stmt = select(bucket, requests, successes, errors, ptok, ctok, ttok, cost)
        stmt = apply_filter(stmt).group_by(bucket).order_by(bucket).limit(limit)
        rows = (await db.execute(stmt)).all()
        return [
            CostRow(
                key=str(r.bucket),
                label=str(r.bucket),
                requests=r.requests or 0,
                successes=r.successes or 0,
                errors=r.errors or 0,
                prompt_tokens=r.prompt_tokens or 0,
                completion_tokens=r.completion_tokens or 0,
                total_tokens=r.total_tokens or 0,
                cost_usd=float(r.cost_usd or 0.0),
            )
            for r in rows
        ]

    if group_by == "user":
        stmt = select(
            QueryHistory.user_id, UserModel.username,
            requests, successes, errors, ptok, ctok, ttok, cost,
        ).join(UserModel, QueryHistory.user_id == UserModel.id)
        stmt = (
            apply_filter(stmt)
            .group_by(QueryHistory.user_id, UserModel.username)
            .order_by(desc(cost))
            .limit(limit)
        )
        rows = (await db.execute(stmt)).all()
        return [
            CostRow(
                key=str(r.user_id),
                label=r.username,
                requests=r.requests or 0,
                successes=r.successes or 0,
                errors=r.errors or 0,
                prompt_tokens=r.prompt_tokens or 0,
                completion_tokens=r.completion_tokens or 0,
                total_tokens=r.total_tokens or 0,
                cost_usd=float(r.cost_usd or 0.0),
            )
            for r in rows
        ]

    if group_by == "model":
        stmt = select(
            QueryHistory.model_used,
            requests, successes, errors, ptok, ctok, ttok, cost,
        )
        stmt = (
            apply_filter(stmt)
            .group_by(QueryHistory.model_used)
            .order_by(desc(cost))
            .limit(limit)
        )
        rows = (await db.execute(stmt)).all()
        return [
            CostRow(
                key=r.model_used or "<unknown>",
                label=r.model_used or "<unknown model>",
                requests=r.requests or 0,
                successes=r.successes or 0,
                errors=r.errors or 0,
                prompt_tokens=r.prompt_tokens or 0,
                completion_tokens=r.completion_tokens or 0,
                total_tokens=r.total_tokens or 0,
                cost_usd=float(r.cost_usd or 0.0),
            )
            for r in rows
        ]

    if group_by == "sector":
        stmt = select(
            QueryHistory.sector_id, Sector.code, Sector.name,
            requests, successes, errors, ptok, ctok, ttok, cost,
        ).join(Sector, QueryHistory.sector_id == Sector.id)
        stmt = (
            apply_filter(stmt)
            .group_by(QueryHistory.sector_id, Sector.code, Sector.name)
            .order_by(desc(cost))
            .limit(limit)
        )
        rows = (await db.execute(stmt)).all()
        return [
            CostRow(
                key=r.code,
                label=r.name,
                requests=r.requests or 0,
                successes=r.successes or 0,
                errors=r.errors or 0,
                prompt_tokens=r.prompt_tokens or 0,
                completion_tokens=r.completion_tokens or 0,
                total_tokens=r.total_tokens or 0,
                cost_usd=float(r.cost_usd or 0.0),
            )
            for r in rows
        ]

    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        detail=f"Invalid group_by={group_by!r}; use day, user, model, or sector",
    )


# ---------------------------------------------------------------------------
# Sector-scoped endpoint (Colonel+)
# ---------------------------------------------------------------------------

@router.get("/sectors/{sector_id}/cost-summary", response_model=CostSummary)
async def sector_cost_summary(
    *,
    sector: SectorContext = Depends(current_sector),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_sector_colonel),
    from_date: Optional[date] = Query(default=None, alias="from"),
    to_date: Optional[date] = Query(default=None, alias="to"),
    group_by: GroupBy = Query(default="day"),
    limit: int = Query(default=200, ge=1, le=500),
):
    if group_by == "sector":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="group_by=sector requires the cross-sector endpoint (General only)",
        )

    from_dt, to_dt = _coerce_range(from_date, to_date)

    def apply(stmt):
        stmt = stmt.where(QueryHistory.sector_id == sector.sector.id)
        if from_dt:
            stmt = stmt.where(QueryHistory.created_at >= from_dt)
        if to_dt:
            stmt = stmt.where(QueryHistory.created_at <= to_dt)
        return stmt

    rows = await _grouped(db, group_by=group_by, apply_filter=apply, limit=limit)
    total = await _build_total(
        db, apply, from_date=from_date, to_date=to_date
    )

    return CostSummary(
        group_by=group_by,
        from_date=from_date,
        to_date=to_date,
        rows=rows,
        total=total,
    )


# ---------------------------------------------------------------------------
# Global endpoint (General-only)
# ---------------------------------------------------------------------------

@router.get("/cost-summary", response_model=CostSummary)
async def global_cost_summary(
    *,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_general),
    from_date: Optional[date] = Query(default=None, alias="from"),
    to_date: Optional[date] = Query(default=None, alias="to"),
    group_by: GroupBy = Query(default="sector"),
    sector_id: Optional[uuid.UUID] = None,
    limit: int = Query(default=200, ge=1, le=500),
):
    """Cross-sector aggregates. Defaults to `group_by=sector` so the
    General sees which tenant is burning the most spend."""
    from_dt, to_dt = _coerce_range(from_date, to_date)

    def apply(stmt):
        if sector_id:
            stmt = stmt.where(QueryHistory.sector_id == sector_id)
        if from_dt:
            stmt = stmt.where(QueryHistory.created_at >= from_dt)
        if to_dt:
            stmt = stmt.where(QueryHistory.created_at <= to_dt)
        return stmt

    rows = await _grouped(db, group_by=group_by, apply_filter=apply, limit=limit)
    total = await _build_total(
        db, apply, from_date=from_date, to_date=to_date
    )

    return CostSummary(
        group_by=group_by,
        from_date=from_date,
        to_date=to_date,
        rows=rows,
        total=total,
    )
