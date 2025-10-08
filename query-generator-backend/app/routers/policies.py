"""
Policies router for managing catalog safety policies

Uses soft delete pattern:
- When policy is "updated", old policy is soft-deleted and new policy is created
- This creates a complete audit trail of all policy changes
- Active policy is where deleted_at IS NULL
"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import require_admin, require_data_guy, require_user, User
from app.deps.db import get_db
from app.models.policies import Policy

logger = structlog.get_logger()
router = APIRouter()


class PolicyResponse(BaseModel):
    """Policy response schema (only returns active policy, not deleted ones)"""
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
    """Get active policy for a catalog (deleted_at IS NULL)"""
    stmt = select(Policy).where(
        and_(
            Policy.catalog_id == catalog_id,
            Policy.deleted_at.is_(None)
        )
    )
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
        created_by=policy.created_by
    )


@router.put("/{catalog_id}", response_model=PolicyResponse)
async def update_policy(
    catalog_id: uuid.UUID,
    policy_update: PolicyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Update policy for a catalog (admin only).
    
    Uses soft delete pattern:
    1. Find existing active policy (deleted_at IS NULL)
    2. If exists, soft delete it (set deleted_at and deleted_by)
    3. Create new policy with updated values
    4. This creates complete audit trail of all policy changes
    """
    # Find existing active policy
    stmt = select(Policy).where(
        and_(
            Policy.catalog_id == catalog_id,
            Policy.deleted_at.is_(None)
        )
    )
    result = await db.execute(stmt)
    existing_policy = result.scalar_one_or_none()
    
    # Prepare new policy values
    if existing_policy:
        # Soft delete the old policy
        existing_policy.deleted_at = datetime.utcnow()
        existing_policy.deleted_by = current_user.id
        
        # Use existing values as base, then apply updates
        new_allow_write = policy_update.allow_write if policy_update.allow_write is not None else existing_policy.allow_write
        new_default_limit = policy_update.default_limit if policy_update.default_limit is not None else existing_policy.default_limit
        new_banned_tables = policy_update.banned_tables if policy_update.banned_tables is not None else (existing_policy.banned_tables or [])
        new_banned_columns = policy_update.banned_columns if policy_update.banned_columns is not None else (existing_policy.banned_columns or [])
        new_banned_schemas = policy_update.banned_schemas if policy_update.banned_schemas is not None else (existing_policy.banned_schemas or [])
        new_pii_tags = policy_update.pii_tags if policy_update.pii_tags is not None else (existing_policy.pii_tags or [])
        new_pii_masking_enabled = policy_update.pii_masking_enabled if policy_update.pii_masking_enabled is not None else existing_policy.pii_masking_enabled
        new_max_rows_returned = policy_update.max_rows_returned if policy_update.max_rows_returned is not None else existing_policy.max_rows_returned
        new_allowed_functions = policy_update.allowed_functions if policy_update.allowed_functions is not None else existing_policy.allowed_functions
        new_blocked_functions = policy_update.blocked_functions if policy_update.blocked_functions is not None else existing_policy.blocked_functions
        new_settings = policy_update.settings if policy_update.settings is not None else (existing_policy.settings or {})
        
        logger.info(
            "Soft deleting existing policy",
            catalog_id=catalog_id,
            old_policy_id=existing_policy.id,
            deleted_by=current_user.id
        )
    else:
        # No existing policy, use defaults with updates applied
        new_allow_write = policy_update.allow_write if policy_update.allow_write is not None else False
        new_default_limit = policy_update.default_limit if policy_update.default_limit is not None else 1000
        new_banned_tables = policy_update.banned_tables if policy_update.banned_tables is not None else []
        new_banned_columns = policy_update.banned_columns if policy_update.banned_columns is not None else []
        new_banned_schemas = policy_update.banned_schemas if policy_update.banned_schemas is not None else []
        new_pii_tags = policy_update.pii_tags if policy_update.pii_tags is not None else []
        new_pii_masking_enabled = policy_update.pii_masking_enabled if policy_update.pii_masking_enabled is not None else False
        new_max_rows_returned = policy_update.max_rows_returned if policy_update.max_rows_returned is not None else None
        new_allowed_functions = policy_update.allowed_functions if policy_update.allowed_functions is not None else None
        new_blocked_functions = policy_update.blocked_functions if policy_update.blocked_functions is not None else None
        new_settings = policy_update.settings if policy_update.settings is not None else {}
    
    # Create new policy with updated values
    new_policy = Policy(
        catalog_id=catalog_id,
        allow_write=new_allow_write,
        default_limit=new_default_limit,
        banned_tables=new_banned_tables,
        banned_columns=new_banned_columns,
        banned_schemas=new_banned_schemas,
        pii_tags=new_pii_tags,
        pii_masking_enabled=new_pii_masking_enabled,
        max_rows_returned=new_max_rows_returned,
        allowed_functions=new_allowed_functions,
        blocked_functions=new_blocked_functions,
        settings=new_settings,
        created_by=current_user.id,
        deleted_at=None,
        deleted_by=None
    )
    
    db.add(new_policy)
    await db.commit()
    await db.refresh(new_policy)
    
    logger.info(
        "Created new policy version",
        catalog_id=catalog_id,
        new_policy_id=new_policy.id,
        created_by=current_user.id,
        had_previous_version=existing_policy is not None
    )
    
    return PolicyResponse(
        catalog_id=new_policy.catalog_id,
        allow_write=new_policy.allow_write,
        default_limit=new_policy.default_limit,
        banned_tables=new_policy.banned_tables or [],
        banned_columns=new_policy.banned_columns or [],
        banned_schemas=new_policy.banned_schemas or [],
        pii_tags=new_policy.pii_tags or [],
        pii_masking_enabled=new_policy.pii_masking_enabled,
        max_rows_returned=new_policy.max_rows_returned,
        allowed_functions=new_policy.allowed_functions,
        blocked_functions=new_policy.blocked_functions,
        settings=new_policy.settings or {},
        created_by=new_policy.created_by
    ) 