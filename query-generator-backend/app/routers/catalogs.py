"""
Catalogs router for managing database schema catalogs
"""
import time
import uuid
from typing import List

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.embeddings import create_embeddings_for_catalog
from app.deps.auth import require_admin, require_data_guy, require_user, User
from app.deps.db import get_db
from app.models.catalog import Catalog, CatalogObject
from app.models.policies import Policy
from app.schemas.catalog import (
    Catalog as CatalogSchema,
    CatalogCreate,
    CatalogReindexRequest,
    CatalogReindexResponse,
    CatalogSummary,
    CatalogUpdate,
    CatalogJsonSchema
)

logger = structlog.get_logger()
router = APIRouter()


def flatten_catalog_json(catalog_data: dict, catalog_id: uuid.UUID) -> List[CatalogObject]:
    """
    Flatten catalog JSON into CatalogObject instances.
    
    Args:
        catalog_data: Raw catalog JSON data
        catalog_id: Catalog UUID
        
    Returns:
        List of CatalogObject instances
    """
    objects = []
    
    for schema in catalog_data.get("schemas", []):
        schema_name = schema["name"]
        
        # Create schema object
        schema_obj = CatalogObject(
            catalog_id=catalog_id,
            object_type="schema",
            schema_name=schema_name
        )
        objects.append(schema_obj)
        
        for table in schema.get("tables", []):
            table_name = table["name"]
            
            # Create table object
            table_obj = CatalogObject(
                catalog_id=catalog_id,
                object_type="table",
                schema_name=schema_name,
                table_name=table_name,
                comment=table.get("comment"),
                                    object_metadata={
                        "type": table.get("type", "table"),
                        "primary_key": table.get("primary_key", []),
                        "foreign_keys": table.get("foreign_keys", []),
                        "indexes": table.get("indexes", [])
                    }
            )
            objects.append(table_obj)
            
            for column in table.get("columns", []):
                # Create column object
                column_obj = CatalogObject(
                    catalog_id=catalog_id,
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
                    object_metadata={
                        "default": column.get("default")
                    }
                )
                objects.append(column_obj)
    
    return objects


@router.post("", response_model=CatalogSchema)
async def create_catalog(
    catalog_create: CatalogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Create a new catalog from uploaded JSON schema.
    """
    logger.info(
        "Creating catalog",
        catalog_name=catalog_create.catalog_name,
        engine=catalog_create.engine,
        user_id=current_user.id
    )
    
    # Validate JSON structure
    try:
        CatalogJsonSchema(**catalog_create.raw_json)
    except Exception as e:
        logger.error("Invalid catalog JSON", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid catalog JSON: {str(e)}"
        )
    
    # Check for duplicate catalog name
    stmt = select(Catalog).where(Catalog.catalog_name == catalog_create.catalog_name)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Catalog with this name already exists"
        )
    
    # Create catalog
    db_catalog = Catalog(
        engine=catalog_create.engine,
        catalog_name=catalog_create.catalog_name,
        version=catalog_create.version,
        raw_json=catalog_create.raw_json,
        description=catalog_create.description,
        is_active=catalog_create.is_active
    )
    
    db.add(db_catalog)
    await db.flush()  # Get the ID
    
    # Flatten and create objects
    objects = flatten_catalog_json(catalog_create.raw_json, db_catalog.id)
    db.add_all(objects)
    
    # Create default policy
    default_policy = Policy(
        catalog_id=db_catalog.id,
        allow_write=False,
        default_limit=1000,
        banned_tables=[],
        banned_columns=[],
        banned_schemas=[],
        pii_tags=[],
        pii_masking_enabled=False,
        created_by=current_user.id
    )
    db.add(default_policy)
    
    await db.commit()
    await db.refresh(db_catalog)
    
    # Load objects for response
    stmt = select(Catalog).options(selectinload(Catalog.objects)).where(
        Catalog.id == db_catalog.id
    )
    result = await db.execute(stmt)
    catalog_with_objects = result.scalar_one()
    
    logger.info(
        "Catalog created",
        catalog_id=db_catalog.id,
        objects_count=len(objects),
        created_by=current_user.id
    )
    
    return catalog_with_objects


@router.get("", response_model=List[CatalogSummary])
async def list_catalogs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """
    List all catalogs with summary information.
    """
    stmt = select(Catalog).where(Catalog.is_active == True).order_by(
        Catalog.created_at.desc()
    )
    result = await db.execute(stmt)
    catalogs = result.scalars().all()
    
    # Get object counts for each catalog
    summaries = []
    for catalog in catalogs:
        # Count objects by type
        stmt = select(
            CatalogObject.object_type,
            func.count(CatalogObject.id)
        ).where(
            CatalogObject.catalog_id == catalog.id
        ).group_by(CatalogObject.object_type)
        
        result = await db.execute(stmt)
        object_counts = dict(result.fetchall())
        
        summary = CatalogSummary(
            id=catalog.id,
            engine=catalog.engine,
            catalog_name=catalog.catalog_name,
            version=catalog.version,
            description=catalog.description,
            is_active=catalog.is_active,
            created_at=catalog.created_at,
            updated_at=catalog.updated_at,
            object_counts=object_counts
        )
        summaries.append(summary)
    
    return summaries


@router.get("/{catalog_id}", response_model=CatalogSchema)
async def get_catalog(
    catalog_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """
    Get a specific catalog with all its objects.
    """
    stmt = select(Catalog).options(selectinload(Catalog.objects)).where(
        Catalog.id == catalog_id
    )
    result = await db.execute(stmt)
    catalog = result.scalar_one_or_none()
    
    if not catalog:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog not found"
        )
    
    return catalog


@router.put("/{catalog_id}", response_model=CatalogSchema)
async def update_catalog(
    catalog_id: uuid.UUID,
    catalog_update: CatalogUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Update catalog metadata.
    """
    stmt = select(Catalog).where(Catalog.id == catalog_id)
    result = await db.execute(stmt)
    catalog = result.scalar_one_or_none()
    
    if not catalog:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog not found"
        )
    
    # Update fields
    if catalog_update.description is not None:
        catalog.description = catalog_update.description
    if catalog_update.is_active is not None:
        catalog.is_active = catalog_update.is_active
    
    await db.commit()
    await db.refresh(catalog)
    
    # Reload with objects relationship
    stmt = select(Catalog).options(selectinload(Catalog.objects)).where(Catalog.id == catalog_id)
    result = await db.execute(stmt)
    catalog = result.scalar_one()
    
    logger.info(
        "Catalog updated",
        catalog_id=catalog_id,
        updated_by=current_user.id
    )
    
    return catalog


@router.post("/{catalog_id}/reindex", response_model=CatalogReindexResponse)
async def reindex_catalog(
    catalog_id: uuid.UUID,
    reindex_request: CatalogReindexRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Reindex catalog embeddings.
    """
    logger.info(
        "Reindexing catalog",
        catalog_id=catalog_id,
        force=reindex_request.force,
        user_id=current_user.id
    )
    
    # Check if catalog exists
    stmt = select(Catalog).where(Catalog.id == catalog_id)
    result = await db.execute(stmt)
    catalog = result.scalar_one_or_none()
    
    if not catalog:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog not found"
        )
    
    # Perform reindexing
    start_time = time.time()
    try:
        created_count, updated_count = await create_embeddings_for_catalog(
            db, catalog_id, force=reindex_request.force
        )
        processing_time = time.time() - start_time
        
        logger.info(
            "Catalog reindexed successfully",
            catalog_id=catalog_id,
            created=created_count,
            updated=updated_count,
            processing_time=processing_time
        )
        
        return CatalogReindexResponse(
            catalog_id=catalog_id,
            status="completed",
            embeddings_created=created_count,
            embeddings_updated=updated_count,
            processing_time_seconds=processing_time
        )
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(
            "Catalog reindexing failed",
            catalog_id=catalog_id,
            error=str(e),
            processing_time=processing_time
        )
        
        return CatalogReindexResponse(
            catalog_id=catalog_id,
            status="failed",
            embeddings_created=0,
            embeddings_updated=0,
            processing_time_seconds=processing_time
        ) 