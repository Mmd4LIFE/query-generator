"""
Policies router for managing catalog safety policies
"""
import uuid
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import require_admin, require_data_guy, require_user, User
from app.deps.db import get_db
from app.models.policies import Policy

logger = structlog.get_logger()
router = APIRouter()


class PolicyResponse(BaseModel):
    """Policy response schema"""
    catalog_id: uuid.UUID
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
    updated_by: Optional[uuid.UUID]

    class Config:
        from_attributes = True


class PolicyUpdate(BaseModel):
    """Policy update schema"""
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


@router.get("/{catalog_id}", response_model=PolicyResponse)
async def get_policy(
    catalog_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get policy for a catalog"""
    stmt = select(Policy).where(Policy.catalog_id == catalog_id)
    result = await db.execute(stmt)
    policy = result.scalar_one_or_none()
    
    if not policy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Policy not found for this catalog"
        )
    
    return PolicyResponse(
        catalog_id=policy.catalog_id,
        allow_write=policy.allow_write,
        default_limit=policy.default_limit,
        banned_tables=policy.banned_tables or [],
        banned_columns=policy.banned_columns or [],
        banned_schemas=policy.banned_schemas or [],
        pii_tags=policy.pii_tags or [],
        pii_masking_enabled=policy.pii_masking_enabled,
        max_rows_returned=policy.max_rows_returned,
        allowed_functions=policy.allowed_functions,
        blocked_functions=policy.blocked_functions,
        settings=policy.settings or {},
        created_by=policy.created_by,
        updated_by=policy.updated_by
    )


@router.put("/{catalog_id}", response_model=PolicyResponse)
async def update_policy(
    catalog_id: uuid.UUID,
    policy_update: PolicyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Update policy for a catalog (admin only)"""
    stmt = select(Policy).where(Policy.catalog_id == catalog_id)
    result = await db.execute(stmt)
    policy = result.scalar_one_or_none()
    
    if not policy:
        # Create new policy if it doesn't exist
        policy = Policy(
            catalog_id=catalog_id,
            allow_write=False,
            default_limit=1000,
            banned_tables=[],
            banned_columns=[],
            banned_schemas=[],
            pii_tags=[],
            pii_masking_enabled=False,
            created_by=current_user.id
        )
        db.add(policy)
    
    # Update fields
    if policy_update.allow_write is not None:
        policy.allow_write = policy_update.allow_write
    
    if policy_update.default_limit is not None:
        policy.default_limit = policy_update.default_limit
    
    if policy_update.banned_tables is not None:
        policy.banned_tables = policy_update.banned_tables
    
    if policy_update.banned_columns is not None:
        policy.banned_columns = policy_update.banned_columns
    
    if policy_update.banned_schemas is not None:
        policy.banned_schemas = policy_update.banned_schemas
    
    if policy_update.pii_tags is not None:
        policy.pii_tags = policy_update.pii_tags
    
    if policy_update.pii_masking_enabled is not None:
        policy.pii_masking_enabled = policy_update.pii_masking_enabled
    
    if policy_update.max_rows_returned is not None:
        policy.max_rows_returned = policy_update.max_rows_returned
    
    if policy_update.allowed_functions is not None:
        policy.allowed_functions = policy_update.allowed_functions
    
    if policy_update.blocked_functions is not None:
        policy.blocked_functions = policy_update.blocked_functions
    
    if policy_update.settings is not None:
        policy.settings = policy_update.settings
    
    policy.updated_by = current_user.id
    
    await db.commit()
    await db.refresh(policy)
    
    logger.info(
        "Policy updated",
        catalog_id=catalog_id,
        updated_by=current_user.id
    )
    
    return PolicyResponse(
        catalog_id=policy.catalog_id,
        allow_write=policy.allow_write,
        default_limit=policy.default_limit,
        banned_tables=policy.banned_tables or [],
        banned_columns=policy.banned_columns or [],
        banned_schemas=policy.banned_schemas or [],
        pii_tags=policy.pii_tags or [],
        pii_masking_enabled=policy.pii_masking_enabled,
        max_rows_returned=policy.max_rows_returned,
        allowed_functions=policy.allowed_functions,
        blocked_functions=policy.blocked_functions,
        settings=policy.settings or {},
        created_by=policy.created_by,
        updated_by=policy.updated_by
    ) 