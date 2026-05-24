"""
Policies router — Phase 2, sector-scoped under
`/v1/sectors/{sector_id}/catalogs/{catalog_id}/policy`.

Soft-delete versioning is preserved: an update closes the old policy
(`deleted_at`, `deleted_by`) and inserts a new active row. The partial
unique index `(catalog_id) WHERE deleted_at IS NULL` guarantees one
active row per catalog (see ROADMAP §5.4).

Visibility & gates:
  - Soldier+ can read the active policy.
  - Colonel+ can update. Captains author catalogs and knowledge but
    policy edits sit higher because policies define safety boundaries
    (`allow_write`, banned schemas, PII).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.deps.auth import (
    SectorContext,
    User,
    get_current_active_user,
    require_sector_colonel,
    require_sector_soldier,
)
from app.deps.db import get_db
from app.models.catalog import Catalog
from app.models.policies import Policy

logger = structlog.get_logger()
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PolicyResponse(BaseModel):
    catalog_id: uuid.UUID
    sector_id: uuid.UUID
    allow_write: bool
    default_limit: Optional[int]
    banned_tables: List[str]
    banned_columns: List[str]
    banned_schemas: List[str]
    pii_tags: List[str]
    pii_masking_enabled: bool
    max_rows_returned: Optional[int]
    allowed_functions: Optional[List[str]]
    blocked_functions: Optional[List[str]]
    settings: Dict[str, Any]
    created_by: uuid.UUID

    class Config:
        from_attributes = True


class PolicyUpdate(BaseModel):
    allow_write: Optional[bool] = None
    default_limit: Optional[int] = None
    banned_tables: Optional[List[str]] = None
    banned_columns: Optional[List[str]] = None
    banned_schemas: Optional[List[str]] = None
    pii_tags: Optional[List[str]] = None
    pii_masking_enabled: Optional[bool] = None
    max_rows_returned: Optional[int] = None
    allowed_functions: Optional[List[str]] = None
    blocked_functions: Optional[List[str]] = None
    settings: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _assert_catalog_in_sector(
    db: AsyncSession, *, catalog_id: uuid.UUID, sector_id: uuid.UUID
) -> Catalog:
    """Return the catalog or 404. Existence-leak-safe across sectors."""
    row = (await db.execute(
        select(Catalog).where(
            Catalog.id == catalog_id, Catalog.sector_id == sector_id
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Catalog not found"
        )
    return row


async def _active_policy(
    db: AsyncSession, *, catalog_id: uuid.UUID, sector_id: uuid.UUID
) -> Optional[Policy]:
    return (await db.execute(
        select(Policy).where(
            and_(
                Policy.catalog_id == catalog_id,
                Policy.sector_id == sector_id,
                Policy.deleted_at.is_(None),
            )
        )
    )).scalar_one_or_none()


def _to_response(p: Policy) -> PolicyResponse:
    return PolicyResponse(
        catalog_id=p.catalog_id,
        sector_id=p.sector_id,
        allow_write=p.allow_write,
        default_limit=p.default_limit,
        banned_tables=p.banned_tables or [],
        banned_columns=p.banned_columns or [],
        banned_schemas=p.banned_schemas or [],
        pii_tags=p.pii_tags or [],
        pii_masking_enabled=p.pii_masking_enabled,
        max_rows_returned=p.max_rows_returned,
        allowed_functions=p.allowed_functions,
        blocked_functions=p.blocked_functions,
        settings=p.settings or {},
        created_by=p.created_by,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("", response_model=PolicyResponse)
async def get_policy(
    catalog_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(require_sector_soldier),
    db: AsyncSession = Depends(get_db),
) -> PolicyResponse:
    await _assert_catalog_in_sector(
        db, catalog_id=catalog_id, sector_id=sector.sector.id
    )
    policy = await _active_policy(
        db, catalog_id=catalog_id, sector_id=sector.sector.id
    )
    if policy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy not found for this catalog",
        )
    return _to_response(policy)


@router.put("", response_model=PolicyResponse)
async def update_policy(
    catalog_id: uuid.UUID,
    body: PolicyUpdate,
    *,
    sector: SectorContext = Depends(require_sector_colonel),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_active_user),
) -> PolicyResponse:
    """Soft-delete the active policy and insert a new version.

    Each PUT creates a complete audit row in `dq_audit_log` with before/after
    deltas, and the prior policy row stays in the DB with `deleted_at` /
    `deleted_by` set — the full change history is queryable.
    """
    await _assert_catalog_in_sector(
        db, catalog_id=catalog_id, sector_id=sector.sector.id
    )
    existing = await _active_policy(
        db, catalog_id=catalog_id, sector_id=sector.sector.id
    )

    def _pick(field: str, default):
        v = getattr(body, field)
        if v is not None:
            return v
        if existing is not None:
            return getattr(existing, field, default)
        return default

    new_values = {
        "allow_write":         _pick("allow_write", False),
        "default_limit":       _pick("default_limit", 1000),
        "banned_tables":       _pick("banned_tables", []) or [],
        "banned_columns":      _pick("banned_columns", []) or [],
        "banned_schemas":      _pick("banned_schemas", []) or [],
        "pii_tags":            _pick("pii_tags", []) or [],
        "pii_masking_enabled": _pick("pii_masking_enabled", False),
        "max_rows_returned":   _pick("max_rows_returned", None),
        "allowed_functions":   _pick("allowed_functions", None),
        "blocked_functions":   _pick("blocked_functions", None),
        "settings":            _pick("settings", {}) or {},
    }

    if existing is not None:
        existing.deleted_at = datetime.utcnow()
        existing.deleted_by = actor.id

    new_policy = Policy(
        sector_id=sector.sector.id,
        catalog_id=catalog_id,
        created_by=actor.id,
        **new_values,
    )
    db.add(new_policy)
    await db.flush()

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector.sector.id,
        action="policy.update",
        target_type="catalog",
        target_id=catalog_id,
        diff={
            "before": {
                "policy_id": str(existing.id) if existing else None,
                **({k: getattr(existing, k, None) for k in new_values} if existing else {}),
            },
            "after": {"policy_id": str(new_policy.id), **new_values},
        },
    )
    await db.commit()
    await db.refresh(new_policy)

    logger.info(
        "policy.update",
        catalog_id=str(catalog_id),
        sector_id=str(sector.sector.id),
        new_policy_id=str(new_policy.id),
        previous=str(existing.id) if existing else None,
        actor=actor.username,
    )

    return _to_response(new_policy)
