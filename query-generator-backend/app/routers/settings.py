"""
Settings router — **global** DB-backed runtime configuration. General-only.

GET    /v1/settings              list every known setting (DB or default)
GET    /v1/settings/models       curated GEN/EMBED model registry for UI dropdowns
GET    /v1/settings/{key}        read one
PUT    /v1/settings/{key}        update one (validated against registry)
POST   /v1/settings/{key}/reset  drop the override row, fall back to default

Sector-scoped overrides live under `/v1/sectors/{sid}/settings/...` (Phase 2).
"""
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.model_registry import list_embed_models, list_gen_models
from app.core.settings_registry import get_spec
from app.core.settings_service import (
    list_all,
    reset_to_default,
    set_value,
)
from app.deps.auth import require_general, User
from app.deps.db import get_db

logger = structlog.get_logger()
router = APIRouter()


class SettingItem(BaseModel):
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


class SettingUpdate(BaseModel):
    value: Any


class ModelsResponse(BaseModel):
    gen_models: List[Dict[str, Any]]
    embed_models: List[Dict[str, Any]]


@router.get("", response_model=List[SettingItem])
async def list_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Return every registered setting (current value + spec metadata)."""
    return await list_all(db)


@router.get("/models", response_model=ModelsResponse)
async def list_models(
    current_user: User = Depends(require_general),
):
    """Curated list of OpenAI models the Settings UI can show in dropdowns."""
    return ModelsResponse(
        gen_models=list_gen_models(),
        embed_models=list_embed_models(),
    )


@router.get("/{key}", response_model=SettingItem)
async def get_one(
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Read one setting (or its default)."""
    spec = get_spec(key)
    if not spec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown setting key")
    items = await list_all(db)
    for item in items:
        if item["key"] == key:
            return item
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")


@router.put("/{key}", response_model=SettingItem)
async def update_one(
    key: str,
    payload: SettingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Validate and persist a new value for `key`."""
    spec = get_spec(key)
    if not spec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown setting key")
    try:
        await set_value(
            db,
            key,
            payload.value,
            scope="global",
            sector_id=None,
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    logger.info("Setting updated", key=key, updated_by=current_user.id)
    items = await list_all(db)
    return next(item for item in items if item["key"] == key)


@router.post("/{key}/reset", response_model=SettingItem)
async def reset_one(
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Delete the override row so the registry default applies again."""
    spec = get_spec(key)
    if not spec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown setting key")
    await reset_to_default(db, key, scope="global", sector_id=None)
    logger.info("Setting reset to default", key=key, by=current_user.id)
    items = await list_all(db)
    return next(item for item in items if item["key"] == key)
