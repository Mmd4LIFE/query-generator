"""
Sector management — Generals create/archive sectors and (with Colonels)
manage memberships.

URL shape:
    /v1/sectors                       — list (General sees all, others their own)
    /v1/sectors                       — POST: create (General only)
    /v1/sectors/{sid}                 — GET/PATCH/DELETE
    /v1/sectors/{sid}/members         — list / assign / remove
"""
import uuid
from datetime import datetime
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import write_audit
from app.deps.auth import (
    SectorContext,
    User,
    active_role_rows,
    current_sector,
    get_current_active_user,
    is_general,
    require_general,
    require_sector_colonel,
)
from app.deps.db import get_db
from app.models.auth import UserRole, User as UserModel
from app.models.sector import Sector

logger = structlog.get_logger()
router = APIRouter()


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class SectorOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    description: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SectorCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=50, pattern=r"^[a-z0-9_]+$")
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class SectorUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class MemberOut(BaseModel):
    user_id: uuid.UUID
    username: str
    email: str
    full_name: Optional[str] = None
    role: str

    class Config:
        from_attributes = True


class MemberAssign(BaseModel):
    user_id: uuid.UUID
    role: str  # colonel | captain | soldier


# -----------------------------------------------------------------------------
# Sector listing & CRUD
# -----------------------------------------------------------------------------
@router.get("", response_model=List[SectorOut])
async def list_sectors(
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    """Generals see every active sector; everyone else sees only their own."""
    stmt = select(Sector).where(Sector.deleted_at.is_(None)).order_by(Sector.created_at.desc())
    if not is_general(current_user):
        sector_ids = {r.sector_id for r in active_role_rows(current_user) if r.sector_id}
        if not sector_ids:
            return []
        stmt = stmt.where(Sector.id.in_(sector_ids))
    return (await db.execute(stmt)).scalars().all()


@router.post("", response_model=SectorOut, status_code=status.HTTP_201_CREATED)
async def create_sector(
    payload: SectorCreate,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(require_general),
):
    sector = Sector(code=payload.code, name=payload.name, description=payload.description)
    db.add(sector)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Sector code '{payload.code}' already exists")
    await db.refresh(sector)
    write_audit(
        db, actor_id=current_user.id, action="sector.create",
        sector_id=sector.id, target_type="sector", target_id=sector.id,
        diff={"after": {"code": sector.code, "name": sector.name}},
    )
    await db.commit()
    return sector


@router.get("/{sector_id}", response_model=SectorOut)
async def get_sector(ctx: SectorContext = Depends(current_sector)):
    return ctx.sector


@router.patch("/{sector_id}", response_model=SectorOut)
async def update_sector(
    payload: SectorUpdate,
    ctx: SectorContext = Depends(require_sector_colonel),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    sector = ctx.sector
    before = {"name": sector.name, "description": sector.description, "is_active": sector.is_active}
    if payload.name is not None:
        sector.name = payload.name
    if payload.description is not None:
        sector.description = payload.description
    if payload.is_active is not None:
        # Only Generals can deactivate a sector — Colonels can only rename.
        if not ctx.is_general:
            raise HTTPException(status_code=403, detail="Only a General can activate/deactivate sectors")
        sector.is_active = payload.is_active
    await db.commit()
    await db.refresh(sector)
    write_audit(
        db, actor_id=current_user.id, action="sector.update",
        sector_id=sector.id, target_type="sector", target_id=sector.id,
        diff={"before": before, "after": {
            "name": sector.name, "description": sector.description, "is_active": sector.is_active
        }},
    )
    await db.commit()
    return sector


@router.delete("/{sector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_sector(
    sector_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(require_general),
):
    """Soft-delete (archive) a sector. Generals only."""
    sector = (
        await db.execute(select(Sector).where(Sector.id == sector_id, Sector.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if not sector:
        raise HTTPException(status_code=404, detail="Sector not found")
    sector.deleted_at = datetime.utcnow()
    sector.is_active = False
    await db.commit()
    write_audit(
        db, actor_id=current_user.id, action="sector.archive",
        sector_id=sector.id, target_type="sector", target_id=sector.id,
    )
    await db.commit()
    return None


# -----------------------------------------------------------------------------
# Members
# -----------------------------------------------------------------------------
@router.get("/{sector_id}/members", response_model=List[MemberOut])
async def list_members(
    db: AsyncSession = Depends(get_db),
    ctx: SectorContext = Depends(require_sector_colonel),
):
    stmt = (
        select(UserRole, UserModel)
        .join(UserModel, UserModel.id == UserRole.user_id)
        .where(
            UserRole.sector_id == ctx.sector.id,
            UserRole.deleted_at.is_(None),
        )
        .order_by(UserModel.username.asc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        MemberOut(
            user_id=u.id, username=u.username, email=u.email,
            full_name=u.full_name, role=r.role_name,
        )
        for r, u in rows
    ]


@router.post("/{sector_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def assign_member(
    payload: MemberAssign,
    db: AsyncSession = Depends(get_db),
    ctx: SectorContext = Depends(require_sector_colonel),
    current_user: UserModel = Depends(get_current_active_user),
):
    if payload.role not in ("colonel", "captain", "soldier"):
        raise HTTPException(status_code=400, detail="Role must be colonel, captain, or soldier")
    # Only Generals can assign Colonels.
    if payload.role == "colonel" and not ctx.is_general:
        raise HTTPException(status_code=403, detail="Only a General can promote to Colonel")

    user = (
        await db.execute(select(UserModel).options(selectinload(UserModel.roles)).where(UserModel.id == payload.user_id))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")

    # Generals hold cross-sector authority — they are never sector members.
    if is_general(user):
        raise HTTPException(
            status_code=400,
            detail="Generals have global authority and cannot be assigned a sector role",
        )

    # Soft-delete any existing active role in this sector (single role per sector).
    for existing in user.roles:
        if existing.sector_id == ctx.sector.id and existing.deleted_at is None:
            existing.deleted_at = datetime.utcnow()

    new_role = UserRole(user_id=user.id, sector_id=ctx.sector.id, role_name=payload.role)
    db.add(new_role)
    await db.commit()
    write_audit(
        db, actor_id=current_user.id, action="member.assign",
        sector_id=ctx.sector.id, target_type="user", target_id=user.id,
        diff={"role": payload.role},
    )
    await db.commit()
    return MemberOut(
        user_id=user.id, username=user.username, email=user.email,
        full_name=user.full_name, role=payload.role,
    )


@router.delete("/{sector_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ctx: SectorContext = Depends(require_sector_colonel),
    current_user: UserModel = Depends(get_current_active_user),
):
    stmt = select(UserRole).where(
        UserRole.user_id == user_id,
        UserRole.sector_id == ctx.sector.id,
        UserRole.deleted_at.is_(None),
    )
    role = (await db.execute(stmt)).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Membership not found")
    if role.role_name == "colonel" and not ctx.is_general:
        raise HTTPException(status_code=403, detail="Only a General can remove a Colonel")

    role.deleted_at = datetime.utcnow()
    await db.commit()
    write_audit(
        db, actor_id=current_user.id, action="member.remove",
        sector_id=ctx.sector.id, target_type="user", target_id=user_id,
        diff={"removed_role": role.role_name},
    )
    await db.commit()
    return None
