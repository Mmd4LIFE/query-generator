"""
Read/write/seed helpers for runtime-tunable settings.

Reads fall back to the in-code default from `settings_registry` if no row
exists, so the app keeps working even before the seed step runs. Writes
validate against the registry before persisting.
"""
import uuid
from typing import Any, Dict, List, Optional

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings_registry import (
    SettingSpec,
    all_specs,
    get_spec,
    validate_value,
)
from app.deps.db import AsyncSessionLocal
from app.models.settings import Setting

logger = structlog.get_logger()


async def get_value(db: AsyncSession, key: str) -> Any:
    """Read one setting. Returns the registry default if the row is absent."""
    spec = get_spec(key)
    if not spec:
        raise KeyError(f"Unknown setting key: {key}")
    stmt = select(Setting).where(Setting.key == key)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        return spec.default
    return row.value


async def get_value_standalone(key: str) -> Any:
    """Read one setting without a caller-provided session.

    Used by core modules (prompts, retrieval, openai_client) that are
    called from many places and shouldn't have to thread `db` through.
    """
    async with AsyncSessionLocal() as session:
        return await get_value(session, key)


async def set_value(
    db: AsyncSession,
    key: str,
    value: Any,
    updated_by: Optional[uuid.UUID] = None,
) -> Setting:
    """Validate and persist a setting. Upserts on `key`."""
    validate_value(key, value)
    spec = get_spec(key)
    assert spec is not None  # validate_value already raised

    stmt = select(Setting).where(Setting.key == key)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if row is None:
        row = Setting(
            key=key,
            value=value,
            category=spec.category,
            description=spec.description,
            updated_by=updated_by,
        )
        db.add(row)
    else:
        row.value = value
        row.updated_by = updated_by

    await db.commit()
    await db.refresh(row)
    return row


async def list_all(db: AsyncSession) -> List[Dict[str, Any]]:
    """Return every known setting (DB value or default), enriched with spec metadata."""
    stmt = select(Setting)
    result = await db.execute(stmt)
    rows = {r.key: r for r in result.scalars().all()}

    out: List[Dict[str, Any]] = []
    for spec in all_specs():
        row = rows.get(spec.key)
        out.append({
            "key": spec.key,
            "category": spec.category,
            "description": spec.description,
            "ui_type": spec.ui_type,
            "choices": spec.choices,
            "default": spec.default,
            "value": row.value if row else spec.default,
            "is_default": row is None,
            "updated_at": row.updated_at.isoformat() if row else None,
            "updated_by": str(row.updated_by) if row and row.updated_by else None,
        })
    return out


async def reset_to_default(db: AsyncSession, key: str) -> None:
    """Delete the override row so the default takes over again."""
    spec = get_spec(key)
    if not spec:
        raise KeyError(f"Unknown setting key: {key}")
    stmt = select(Setting).where(Setting.key == key)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()


async def seed_defaults() -> None:
    """Insert default rows for any spec missing from dq_settings.

    Idempotent — never overwrites existing rows. Called once at startup
    so the Settings UI has rows to show even on a fresh install.
    """
    async with AsyncSessionLocal() as session:
        stmt = select(Setting.key)
        result = await session.execute(stmt)
        existing = {row[0] for row in result.all()}

        created = 0
        for spec in all_specs():
            if spec.key in existing:
                continue
            session.add(Setting(
                key=spec.key,
                value=spec.default,
                category=spec.category,
                description=spec.description,
            ))
            created += 1

        if created:
            await session.commit()
            logger.info("Seeded default settings", count=created)
        else:
            logger.info("Settings already seeded — nothing to do")
