"""
Read/write/seed helpers for runtime-tunable settings.

Settings live at one of two scopes:
- ``scope='global'`` with ``sector_id IS NULL`` — applies everywhere unless
  overridden.
- ``scope='sector'`` with ``sector_id IS NOT NULL`` — overrides the global
  value for that Sector only.

Resolution order when reading: **sector value → global value → registry default**.
Writes are validated against the registry first.

Callers in core (`openai_client`, `retrieval`, `prompts`) read via
`get_value_standalone(key, sector_id=...)`. Until Phase 2 wires the Sector
context through generate, that `sector_id` is `None` — i.e. global-only —
which matches today's behavior.
"""
import uuid
from typing import Any, Dict, List, Optional

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings_registry import all_specs, get_spec, validate_value
from app.deps.db import AsyncSessionLocal
from app.models.settings import Setting

logger = structlog.get_logger()


# -----------------------------------------------------------------------------
# Internal helpers
# -----------------------------------------------------------------------------
async def _select_row(
    db: AsyncSession,
    key: str,
    *,
    scope: str,
    sector_id: Optional[uuid.UUID],
) -> Optional[Setting]:
    """Fetch the row for one (key, scope, sector_id) triplet."""
    stmt = select(Setting).where(Setting.key == key, Setting.scope == scope)
    if sector_id is None:
        stmt = stmt.where(Setting.sector_id.is_(None))
    else:
        stmt = stmt.where(Setting.sector_id == sector_id)
    return (await db.execute(stmt)).scalar_one_or_none()


# -----------------------------------------------------------------------------
# Reads
# -----------------------------------------------------------------------------
async def get_value(
    db: AsyncSession,
    key: str,
    sector_id: Optional[uuid.UUID] = None,
) -> Any:
    """Resolve a setting value: sector → global → registry default.

    When `sector_id` is None, only the global row (and the default) are
    considered.
    """
    spec = get_spec(key)
    if not spec:
        raise KeyError(f"Unknown setting key: {key}")

    if sector_id is not None:
        row = await _select_row(db, key, scope="sector", sector_id=sector_id)
        if row is not None:
            return row.value

    row = await _select_row(db, key, scope="global", sector_id=None)
    if row is not None:
        return row.value

    return spec.default


async def get_value_standalone(
    key: str,
    sector_id: Optional[uuid.UUID] = None,
) -> Any:
    """`get_value` for callers that don't already have a session.

    Used by core modules (prompts, retrieval, openai_client) that are
    called from many places and shouldn't have to thread `db` through.
    """
    async with AsyncSessionLocal() as session:
        return await get_value(session, key, sector_id=sector_id)


# -----------------------------------------------------------------------------
# Writes
# -----------------------------------------------------------------------------
async def set_value(
    db: AsyncSession,
    key: str,
    value: Any,
    *,
    scope: str = "global",
    sector_id: Optional[uuid.UUID] = None,
    updated_by: Optional[uuid.UUID] = None,
) -> Setting:
    """Validate and persist a setting. Upserts on `(key, scope, sector_id)`."""
    if scope not in ("global", "sector"):
        raise ValueError(f"Invalid scope '{scope}'; must be 'global' or 'sector'")
    if scope == "sector" and sector_id is None:
        raise ValueError("scope='sector' requires sector_id")
    if scope == "global" and sector_id is not None:
        raise ValueError("scope='global' must have sector_id=None")

    validate_value(key, value)
    spec = get_spec(key)
    assert spec is not None  # validate_value already raised

    row = await _select_row(db, key, scope=scope, sector_id=sector_id)
    if row is None:
        row = Setting(
            key=key,
            value=value,
            scope=scope,
            sector_id=sector_id,
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


async def reset_to_default(
    db: AsyncSession,
    key: str,
    *,
    scope: str = "global",
    sector_id: Optional[uuid.UUID] = None,
) -> None:
    """Delete the override row so the next-tier default takes over.

    - Resetting a 'sector' row → falls back to global (or registry default).
    - Resetting a 'global' row → falls back to the registry default.
    """
    spec = get_spec(key)
    if not spec:
        raise KeyError(f"Unknown setting key: {key}")
    row = await _select_row(db, key, scope=scope, sector_id=sector_id)
    if row is not None:
        await db.delete(row)
        await db.commit()


# -----------------------------------------------------------------------------
# Listings
# -----------------------------------------------------------------------------
async def list_all(
    db: AsyncSession,
    sector_id: Optional[uuid.UUID] = None,
) -> List[Dict[str, Any]]:
    """Return every registered setting, enriched with its effective value.

    The `value` field is the **resolved** value for the given context
    (sector → global → default). The `source` field tells you which layer
    the value came from, which the UI needs to render correctly (e.g. show
    a "reset to global" button when source='sector').
    """
    # Pull all relevant rows in one shot.
    stmt = select(Setting).where(Setting.scope == "global", Setting.sector_id.is_(None))
    global_rows = {r.key: r for r in (await db.execute(stmt)).scalars().all()}

    sector_rows: Dict[str, Setting] = {}
    if sector_id is not None:
        stmt = select(Setting).where(
            Setting.scope == "sector", Setting.sector_id == sector_id
        )
        sector_rows = {r.key: r for r in (await db.execute(stmt)).scalars().all()}

    out: List[Dict[str, Any]] = []
    for spec in all_specs():
        s_row = sector_rows.get(spec.key)
        g_row = global_rows.get(spec.key)
        if s_row is not None:
            value, source, row = s_row.value, "sector", s_row
        elif g_row is not None:
            value, source, row = g_row.value, "global", g_row
        else:
            value, source, row = spec.default, "default", None

        out.append({
            "key": spec.key,
            "category": spec.category,
            "description": spec.description,
            "ui_type": spec.ui_type,
            "choices": spec.choices,
            "default": spec.default,
            "value": value,
            "source": source,
            "is_default": source == "default",
            "updated_at": row.updated_at.isoformat() if row else None,
            "updated_by": str(row.updated_by) if row and row.updated_by else None,
        })
    return out


# -----------------------------------------------------------------------------
# Seeding
# -----------------------------------------------------------------------------
async def seed_defaults() -> None:
    """Insert global default rows for any spec missing from `dq_settings`.

    Idempotent — never overwrites existing rows. Always seeds at
    `scope='global', sector_id=NULL`. Sector-scoped overrides are created
    on demand by Colonels via the Sector Settings UI (Phase 2).
    """
    async with AsyncSessionLocal() as session:
        stmt = select(Setting.key).where(
            Setting.scope == "global", Setting.sector_id.is_(None)
        )
        existing = {row[0] for row in (await session.execute(stmt)).all()}

        created = 0
        for spec in all_specs():
            if spec.key in existing:
                continue
            session.add(Setting(
                key=spec.key,
                value=spec.default,
                scope="global",
                sector_id=None,
                category=spec.category,
                description=spec.description,
            ))
            created += 1

        if created:
            await session.commit()
            logger.info("settings.seeded", count=created)
        else:
            logger.info("settings.seeded.noop")
