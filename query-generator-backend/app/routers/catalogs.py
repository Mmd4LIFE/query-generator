"""
Catalogs router — Phase 2, sector-scoped.

Mounted under `/v1/sectors/{sector_id}/catalogs`. Every endpoint resolves
the calling user against the Sector via `current_sector`:
  - Soldier+  can read catalogs in their Sector.
  - Captain+  can create, update, and reindex.
  - General   can soft-delete (TODO; deletes still flow through `is_active`).

The pre-Phase-2 IDOR (any role-gated user could fetch any catalog) is closed
here: queries always include `Catalog.sector_id == sector.id`, and a 404 is
returned (not 403) for catalogs in a Sector the caller does not belong to,
to avoid existence leakage.

Catalog names are unique **per Sector**, not globally — two Sectors can each
own a `production_db`.
"""
from __future__ import annotations

import time
import uuid
from typing import List

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import write_audit
from app.core.embeddings import create_embeddings_for_catalog
from app.deps.auth import (
    SectorContext,
    get_current_active_user,
    require_sector_captain,
    require_sector_soldier,
    User,
)
from app.deps.db import get_db
from app.models.catalog import Catalog, CatalogObject
from app.models.policies import Policy
from app.schemas.catalog import (
    Catalog as CatalogSchema,
    CatalogCreate,
    CatalogJsonSchema,
    CatalogReindexRequest,
    CatalogReindexResponse,
    CatalogSummary,
    CatalogUpdate,
)

logger = structlog.get_logger()
router = APIRouter()


# ---------------------------------------------------------------------------
# Flattening helper — now sector-aware (every object carries sector_id)
# ---------------------------------------------------------------------------

def flatten_catalog_json(
    catalog_data: dict,
    catalog_id: uuid.UUID,
    sector_id: uuid.UUID,
) -> List[CatalogObject]:
    """Flatten catalog JSON into CatalogObject instances, stamped with sector_id."""
    objects: List[CatalogObject] = []

    for schema in catalog_data.get("schemas", []):
        schema_name = schema["name"]

        objects.append(CatalogObject(
            catalog_id=catalog_id,
            sector_id=sector_id,
            object_type="schema",
            schema_name=schema_name,
        ))

        for table in schema.get("tables", []):
            table_name = table["name"]
            objects.append(CatalogObject(
                catalog_id=catalog_id,
                sector_id=sector_id,
                object_type="table",
                schema_name=schema_name,
                table_name=table_name,
                comment=table.get("comment"),
                object_metadata={
                    "type": table.get("type", "table"),
                    "primary_key": table.get("primary_key", []),
                    "foreign_keys": table.get("foreign_keys", []),
                    "indexes": table.get("indexes", []),
                },
            ))

            for column in table.get("columns", []):
                objects.append(CatalogObject(
                    catalog_id=catalog_id,
                    sector_id=sector_id,
                    object_type="column",
                    schema_name=schema_name,
                    table_name=table_name,
                    column_name=column["name"],
                    data_type=column["data_type"],
                    is_nullable=column.get("nullable", True),
                    is_primary_key=column["name"] in table.get("primary_key", []),
                    is_foreign_key=any(
                        column["name"] in fk.get("columns", [])
                        for fk in table.get("foreign_keys", [])
                    ),
                    comment=column.get("comment"),
                    object_metadata={"default": column.get("default")},
                ))

    return objects


async def _load_catalog(
    db: AsyncSession,
    *,
    catalog_id: uuid.UUID,
    sector_id: uuid.UUID,
    with_objects: bool = False,
) -> Catalog:
    """Fetch a catalog scoped to the given sector, or 404."""
    stmt = select(Catalog).where(
        Catalog.id == catalog_id, Catalog.sector_id == sector_id
    )
    if with_objects:
        stmt = stmt.options(selectinload(Catalog.objects))
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Catalog not found"
        )
    return row


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("", response_model=CatalogSchema)
async def create_catalog(
    catalog_create: CatalogCreate,
    *,
    sector: SectorContext = Depends(require_sector_captain),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_active_user),
):
    """Import a catalog snapshot into this Sector."""
    sector_id = sector.sector.id
    logger.info(
        "catalog.create.start",
        catalog_name=catalog_create.catalog_name,
        engine=catalog_create.engine,
        sector_id=str(sector_id),
        user_id=str(actor.id),
    )

    # Validate the JSON shape up front.
    try:
        CatalogJsonSchema(**catalog_create.raw_json)
    except Exception as e:
        logger.error("catalog.create.invalid_json", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid catalog JSON: {e}",
        )

    # Duplicate name check — scoped per Sector.
    dup = (await db.execute(
        select(Catalog.id).where(
            Catalog.sector_id == sector_id,
            Catalog.catalog_name == catalog_create.catalog_name,
        )
    )).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Catalog with this name already exists in this Sector",
        )

    db_catalog = Catalog(
        sector_id=sector_id,
        engine=catalog_create.engine,
        catalog_name=catalog_create.catalog_name,
        version=catalog_create.version,
        raw_json=catalog_create.raw_json,
        description=catalog_create.description,
        is_active=catalog_create.is_active,
    )
    db.add(db_catalog)
    await db.flush()

    objects = flatten_catalog_json(catalog_create.raw_json, db_catalog.id, sector_id)
    db.add_all(objects)

    db.add(Policy(
        sector_id=sector_id,
        catalog_id=db_catalog.id,
        allow_write=False,
        default_limit=1000,
        banned_tables=[],
        banned_columns=[],
        banned_schemas=[],
        pii_tags=[],
        pii_masking_enabled=False,
        created_by=actor.id,
    ))

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector_id,
        action="catalog.create",
        target_type="catalog",
        target_id=db_catalog.id,
        diff={"after": {
            "catalog_name": db_catalog.catalog_name,
            "engine": db_catalog.engine,
            "objects": len(objects),
        }},
    )
    await db.commit()
    await db.refresh(db_catalog)

    # Auto-embed on import. Failure here is non-fatal — the user can
    # retry via reindex; the catalog is already saved.
    try:
        created, updated = await create_embeddings_for_catalog(
            db, db_catalog.id, force=False
        )
        logger.info(
            "catalog.create.auto_embed_ok",
            catalog_id=str(db_catalog.id),
            created=created, updated=updated,
        )
    except Exception as exc:
        logger.error(
            "catalog.create.auto_embed_failed",
            catalog_id=str(db_catalog.id),
            error=str(exc),
        )

    return await _load_catalog(
        db, catalog_id=db_catalog.id, sector_id=sector_id, with_objects=True
    )


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("", response_model=List[CatalogSummary])
async def list_catalogs(
    *,
    sector: SectorContext = Depends(require_sector_soldier),
    db: AsyncSession = Depends(get_db),
    include_inactive: bool = False,
):
    """List catalogs in this Sector."""
    base = select(Catalog).where(Catalog.sector_id == sector.sector.id)
    if not include_inactive:
        base = base.where(Catalog.is_active.is_(True))
    base = base.order_by(Catalog.created_at.desc())

    catalogs = (await db.execute(base)).scalars().all()

    # Single grouped query for all catalogs in one round-trip.
    object_counts_by_catalog: dict[uuid.UUID, dict[str, int]] = {}
    if catalogs:
        ids = [c.id for c in catalogs]
        rows = (await db.execute(
            select(
                CatalogObject.catalog_id,
                CatalogObject.object_type,
                func.count(CatalogObject.id),
            )
            .where(CatalogObject.catalog_id.in_(ids))
            .group_by(CatalogObject.catalog_id, CatalogObject.object_type)
        )).all()
        for cid, otype, count in rows:
            object_counts_by_catalog.setdefault(cid, {})[otype] = count

    return [
        CatalogSummary(
            id=c.id,
            engine=c.engine,
            catalog_name=c.catalog_name,
            version=c.version,
            description=c.description,
            is_active=c.is_active,
            created_at=c.created_at,
            updated_at=c.updated_at,
            object_counts=object_counts_by_catalog.get(c.id, {}),
        )
        for c in catalogs
    ]


# ---------------------------------------------------------------------------
# Read one
# ---------------------------------------------------------------------------

@router.get("/{catalog_id}", response_model=CatalogSchema)
async def get_catalog(
    catalog_id: uuid.UUID,
    *,
    sector: SectorContext = Depends(require_sector_soldier),
    db: AsyncSession = Depends(get_db),
):
    return await _load_catalog(
        db, catalog_id=catalog_id, sector_id=sector.sector.id, with_objects=True
    )


# ---------------------------------------------------------------------------
# Update (description, active flag — schema content is immutable; reupload)
# ---------------------------------------------------------------------------

@router.put("/{catalog_id}", response_model=CatalogSchema)
async def update_catalog(
    catalog_id: uuid.UUID,
    catalog_update: CatalogUpdate,
    *,
    sector: SectorContext = Depends(require_sector_captain),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_active_user),
):
    catalog = await _load_catalog(
        db, catalog_id=catalog_id, sector_id=sector.sector.id, with_objects=False
    )

    before = {
        "description": catalog.description,
        "is_active": catalog.is_active,
    }
    if catalog_update.description is not None:
        catalog.description = catalog_update.description
    if catalog_update.is_active is not None:
        catalog.is_active = catalog_update.is_active

    write_audit(
        db,
        actor_id=actor.id,
        sector_id=sector.sector.id,
        action="catalog.update",
        target_type="catalog",
        target_id=catalog.id,
        diff={
            "before": before,
            "after": {
                "description": catalog.description,
                "is_active": catalog.is_active,
            },
        },
    )
    await db.commit()

    return await _load_catalog(
        db, catalog_id=catalog_id, sector_id=sector.sector.id, with_objects=True
    )


# ---------------------------------------------------------------------------
# Reindex
# ---------------------------------------------------------------------------

@router.post("/{catalog_id}/reindex", response_model=CatalogReindexResponse)
async def reindex_catalog(
    catalog_id: uuid.UUID,
    reindex_request: CatalogReindexRequest,
    *,
    sector: SectorContext = Depends(require_sector_captain),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_active_user),
):
    catalog = await _load_catalog(
        db, catalog_id=catalog_id, sector_id=sector.sector.id, with_objects=False
    )

    logger.info(
        "catalog.reindex.start",
        catalog_id=str(catalog.id),
        sector_id=str(sector.sector.id),
        force=reindex_request.force,
        user_id=str(actor.id),
    )

    start = time.time()
    try:
        created, updated = await create_embeddings_for_catalog(
            db, catalog.id, force=reindex_request.force
        )
        elapsed = time.time() - start

        write_audit(
            db,
            actor_id=actor.id,
            sector_id=sector.sector.id,
            action="catalog.reindex",
            target_type="catalog",
            target_id=catalog.id,
            diff={"after": {
                "force": reindex_request.force,
                "created": created,
                "updated": updated,
            }},
        )
        await db.commit()

        return CatalogReindexResponse(
            catalog_id=catalog.id,
            status="completed",
            embeddings_created=created,
            embeddings_updated=updated,
            processing_time_seconds=elapsed,
        )
    except Exception as e:
        elapsed = time.time() - start
        logger.error(
            "catalog.reindex.failed",
            catalog_id=str(catalog.id),
            error=str(e),
            elapsed=elapsed,
        )
        return CatalogReindexResponse(
            catalog_id=catalog.id,
            status="failed",
            embeddings_created=0,
            embeddings_updated=0,
            processing_time_seconds=elapsed,
        )
