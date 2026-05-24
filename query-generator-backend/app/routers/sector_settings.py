"""
Sector-scoped settings router.

Mounted at `/v1/sectors/{sector_id}/settings`. Colonels and Generals can
read & override settings for **their** Sector here; the global tier still
lives at `/v1/settings/*` and is General-only.

Resolution order on read (server-side, in `settings_service.list_all`):
    sector override → global override → registry default

Each item carries a `source` field (`'sector' | 'global' | 'default'`)
so the UI can render a "reset to global" button when source='sector'.

Only specs with `sector_overridable=True` in the registry can be written
here — operational dials (e.g. `embeddings.batch_size`) refuse sector
writes with HTTP 400.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.settings_registry import get_spec
from app.core.settings_service import (
    list_all,
    reset_to_default,
    set_value,
)
from app.deps.auth import (
    SectorContext,
    User,
    get_current_active_user,
    require_sector_colonel,
)
from app.deps.db import get_db

logger = structlog.get_logger()
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas (mirror the global settings router for consistency)
# ---------------------------------------------------------------------------

class SectorSettingItem(BaseModel):
    key: str
    category: str
    description: str
    ui_type: str
    choices: Optional[List[Dict[str, Any]]] = None
    default: Any
    value: Any
    source: str  # 'sector' | 'global' | 'default'
    is_default: bool
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None
    sector_overridable: bool


class SectorSettingUpdate(BaseModel):
    value: Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enrich(items: List[Dict[str, Any]]) -> List[SectorSettingItem]:
    """Attach the `sector_overridable` flag from the registry."""
    out: List[SectorSettingItem] = []
    for it in items:
        spec = get_spec(it["key"])
        out.append(SectorSettingItem(
            **it,
            sector_overridable=bool(spec and spec.sector_overridable),
        ))
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("", response_model=List[SectorSettingItem])
async def list_sector_settings(
    *,
    sector: SectorContext = Depends(require_sector_colonel),
    db: AsyncSession = Depends(get_db),
):
    """List every registered setting with this Sector's effective value
    and source (sector / global / default)."""
    items = await list_all(db, sector_id=sector.sector.id)
    return _enrich(items)


@router.get("/{key}", response_model=SectorSettingItem)
async def get_sector_setting(
    key: str,
    *,
    sector: SectorContext = Depends(require_sector_colonel),
    db: AsyncSession = Depends(get_db),
):
    spec = get_spec(key)
    if not spec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown setting key")
    items = await list_all(db, sector_id=sector.sector.id)
    for it in items:
        if it["key"] == key:
            return _enrich([it])[0]
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Setting not found")


@router.put("/{key}", response_model=SectorSettingItem)
async def update_sector_setting(
    key: str,
    body: SectorSettingUpdate,
    *,
    sector: SectorContext = Depends(require_sector_colonel),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_active_user),
):
    """Set or update a Sector override for `key`."""
    spec = get_spec(key)
    if not spec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown setting key")
    if not spec.sector_overridable:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Setting {key!r} is not sector-overridable",
        )

    try:
        row = await set_value(
            db,
            key,
            body.value,
            scope="sector",
            sector_id=sector.sector.id,
            updated_by=actor.id,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector.sector.id,
        action="sector_setting.update",
        target_type="setting",
        target_id=row.id,
        diff={"after": {"key": key, "value": body.value}},
    )
    await db.commit()

    logger.info(
        "sector_setting.update",
        key=key,
        sector_id=str(sector.sector.id),
        actor=actor.username,
    )

    items = await list_all(db, sector_id=sector.sector.id)
    return _enrich([it for it in items if it["key"] == key])[0]


@router.post("/{key}/reset", response_model=SectorSettingItem)
async def reset_sector_setting(
    key: str,
    *,
    sector: SectorContext = Depends(require_sector_colonel),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_active_user),
):
    """Delete this Sector's override row; the global (or default) value applies again."""
    spec = get_spec(key)
    if not spec:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown setting key")

    await reset_to_default(
        db, key, scope="sector", sector_id=sector.sector.id
    )

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector.sector.id,
        action="sector_setting.reset",
        target_type="setting",
        target_id=None,
        diff={"after": {"key": key, "value": "<reset to global/default>"}},
    )
    await db.commit()

    logger.info(
        "sector_setting.reset",
        key=key,
        sector_id=str(sector.sector.id),
        actor=actor.username,
    )

    items = await list_all(db, sector_id=sector.sector.id)
    return _enrich([it for it in items if it["key"] == key])[0]
