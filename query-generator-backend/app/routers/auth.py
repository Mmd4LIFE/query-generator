"""
Authentication & user-account router.

Scope split with `routers/sectors.py`:
  - **This router**  owns the User account itself: create, edit, deactivate,
    password reset, plus assigning/revoking the cross-sector `general` role.
  - **Sectors router** owns role membership *inside* a sector
    (`POST /v1/sectors/{sid}/members`, etc.).

All account-mutation endpoints require General. Cost summaries are also
General-only (cross-tenant visibility).
"""
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import write_audit
from app.deps.auth import (
    active_role_rows,
    authenticate_user,
    create_access_token,
    get_current_active_user,
    get_password_hash,
    is_general,
    require_general,
)
from app.deps.db import get_db
from app.models.auth import User, UserRole
from app.models.history import QueryHistory
from app.models.sector import Sector
from app.schemas.auth import (
    LoginRequest,
    SectorMembership,
    Token,
    User as UserSchema,
    UserCreate,
    UserProfile,
    UserUpdate,
    UserStatusUpdate,
    UserRole as UserRoleSchema,
)

logger = structlog.get_logger()
router = APIRouter()


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
async def _build_memberships(
    db: AsyncSession, user: User
) -> Tuple[bool, List[SectorMembership]]:
    """Return (is_general, [SectorMembership]) — used for /login and /me.

    A General is just a user with a role row where `role_name='general'`
    AND `sector_id IS NULL`. They also get to see *all* sectors in the UI,
    but we don't bake that list into the JWT — frontend pulls it from
    `GET /v1/sectors` instead.
    """
    active = active_role_rows(user)
    is_g = any(r.role_name == "general" for r in active)
    sector_ids = [r.sector_id for r in active if r.sector_id is not None]
    if not sector_ids:
        return is_g, []
    rows = (
        await db.execute(
            select(Sector).where(
                Sector.id.in_(sector_ids), Sector.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    by_id = {s.id: s for s in rows}
    out: List[SectorMembership] = []
    for r in active:
        if r.sector_id is None:
            continue
        s = by_id.get(r.sector_id)
        if not s or not s.is_active:
            continue
        out.append(
            SectorMembership(
                sector_id=s.id,
                sector_code=s.code,
                sector_name=s.name,
                role=r.role_name,
            )
        )
    return is_g, out


# -----------------------------------------------------------------------------
# Login & profile
# -----------------------------------------------------------------------------
@router.post("/login", response_model=Token)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, req.username, req.password)
    if not user:
        logger.warning("login.failed", username=req.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User is deactivated")

    # We loaded the user via `authenticate_user` without joining roles —
    # re-fetch with roles eagerly loaded so `_build_memberships` doesn't lazy-load.
    user = (
        await db.execute(
            select(User).options(selectinload(User.roles)).where(User.id == user.id)
        )
    ).scalar_one()

    user.last_login = datetime.utcnow()
    await db.commit()

    is_g, memberships = await _build_memberships(db, user)
    token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=1440),
    )
    logger.info("login.ok", user_id=str(user.id), is_general=is_g)
    return Token(
        access_token=token,
        token_type="bearer",
        is_general=is_g,
        sectors=memberships,
    )


@router.get("/me", response_model=UserProfile)
async def me(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    is_g, memberships = await _build_memberships(db, current_user)
    return UserProfile(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        full_name=current_user.full_name,
        is_active=current_user.is_active,
        is_general=is_g,
        sectors=memberships,
        created_at=current_user.created_at,
        last_login=current_user.last_login,
    )


# -----------------------------------------------------------------------------
# Account CRUD (General only)
# -----------------------------------------------------------------------------
@router.post("/users", response_model=UserSchema, status_code=201)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Create a new user account. No roles are assigned here — use
    `/v1/sectors/{sid}/members` for sector roles, or `POST
    /auth/users/{id}/promote-to-general` to make them a General.
    """
    dup = (
        await db.execute(
            select(User).where(
                (User.username == payload.username) | (User.email == payload.email)
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(
            status_code=400, detail="Username or email already registered"
        )

    user = User(
        username=payload.username,
        email=payload.email,
        hashed_password=get_password_hash(payload.password),
        full_name=payload.full_name,
        is_active=payload.is_active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await write_audit(
        db,
        actor_id=current_user.id,
        action="user.create",
        target_type="user",
        target_id=user.id,
        diff={"after": {"username": user.username, "email": user.email}},
    )
    await db.commit()

    # Reload with empty roles relationship so the schema serializer is happy.
    user = (
        await db.execute(
            select(User).options(selectinload(User.roles)).where(User.id == user.id)
        )
    ).scalar_one()
    return user


@router.get("/users", response_model=List[UserSchema])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    stmt = (
        select(User)
        .options(selectinload(User.roles))
        .order_by(User.created_at.desc())
    )
    return (await db.execute(stmt)).scalars().all()


@router.put("/users/{user_id}", response_model=UserSchema)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    user = (
        await db.execute(
            select(User).options(selectinload(User.roles)).where(User.id == user_id)
        )
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    before = {"email": user.email, "full_name": user.full_name, "is_active": user.is_active}

    if payload.email and payload.email != user.email:
        dup = (
            await db.execute(select(User).where(User.email == payload.email))
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=400, detail="Email already registered")
        user.email = payload.email
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password is not None:
        user.hashed_password = get_password_hash(payload.password)

    user.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(user)

    await write_audit(
        db,
        actor_id=current_user.id,
        action="user.update",
        target_type="user",
        target_id=user.id,
        diff={
            "before": before,
            "after": {
                "email": user.email,
                "full_name": user.full_name,
                "is_active": user.is_active,
            },
        },
    )
    await db.commit()
    return user


@router.patch("/users/{user_id}/status")
async def set_user_status(
    user_id: str,
    payload: UserStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id and payload.is_active is False:
        raise HTTPException(
            status_code=400, detail="Cannot deactivate your own account"
        )
    before = user.is_active
    user.is_active = payload.is_active
    user.updated_at = datetime.utcnow()
    await db.commit()
    await write_audit(
        db,
        actor_id=current_user.id,
        action="user.status",
        target_type="user",
        target_id=user.id,
        diff={"before": before, "after": payload.is_active},
    )
    await db.commit()
    return {"user_id": user_id, "is_active": payload.is_active}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Hard-delete a user. Foreign keys on `dq_history`, `dq_feedback`, audit
    rows, etc. are RESTRICTed — they prevent accidental deletion of users
    who left a trail. Soft-deactivation via PATCH /status is the usual path.
    """
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    username = user.username
    await db.delete(user)
    await db.commit()
    await write_audit(
        db,
        actor_id=current_user.id,
        action="user.delete",
        target_type="user",
        target_id=user.id,
        diff={"username": username},
    )
    await db.commit()
    return {"deleted_user_id": user_id, "username": username}


# -----------------------------------------------------------------------------
# General-role assignment (cross-sector — separate from sector membership)
# -----------------------------------------------------------------------------
@router.post("/users/{user_id}/promote-to-general", response_model=UserRoleSchema)
async def promote_to_general(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Grant the `general` role (cross-sector). Idempotent."""
    user = (
        await db.execute(
            select(User).options(selectinload(User.roles)).where(User.id == user_id)
        )
    ).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")

    existing = next(
        (
            r
            for r in user.roles
            if r.role_name == "general" and r.deleted_at is None
        ),
        None,
    )
    if existing:
        return existing

    role = UserRole(user_id=user.id, sector_id=None, role_name="general")
    db.add(role)
    await db.commit()
    await db.refresh(role)
    await write_audit(
        db,
        actor_id=current_user.id,
        action="user.promote_general",
        target_type="user",
        target_id=user.id,
    )
    await db.commit()
    return role


@router.delete("/users/{user_id}/general", status_code=204)
async def revoke_general(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Revoke the `general` role. A General cannot revoke their own General role
    (would lock out the last admin)."""
    if str(current_user.id) == str(user_id):
        raise HTTPException(
            status_code=400, detail="Generals cannot revoke their own General role"
        )

    role = (
        await db.execute(
            select(UserRole).where(
                UserRole.user_id == user_id,
                UserRole.role_name == "general",
                UserRole.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="User is not a General")
    role.deleted_at = datetime.utcnow()
    await db.commit()
    await write_audit(
        db,
        actor_id=current_user.id,
        action="user.revoke_general",
        target_type="user",
        target_id=role.user_id,
    )
    await db.commit()
    return None


# -----------------------------------------------------------------------------
# Read-only listings
# -----------------------------------------------------------------------------
@router.get("/users/{user_id}/roles", response_model=List[UserRoleSchema])
async def get_user_roles_endpoint(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Return every active role row for a user (all sectors + general)."""
    user = (
        await db.execute(
            select(User).options(selectinload(User.roles)).where(User.id == user_id)
        )
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return [r for r in user.roles if r.deleted_at is None]


@router.get("/users/{user_id}/role-history")
async def get_user_role_history(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Full history of role assignments — active and revoked — for one user."""
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    rows = (
        await db.execute(
            select(UserRole)
            .where(UserRole.user_id == user_id)
            .order_by(UserRole.created_at.desc())
        )
    ).scalars().all()
    return [
        {
            "role_name": r.role_name,
            "sector_id": str(r.sector_id) if r.sector_id else None,
            "assigned_at": r.created_at,
            "removed_at": r.deleted_at,
            "status": "active" if r.deleted_at is None else "inactive",
        }
        for r in rows
    ]


@router.get("/roles")
async def list_available_roles(current_user: User = Depends(get_current_active_user)):
    """Static role catalog — used by frontend dropdowns."""
    return [
        {
            "name": "general",
            "label": "General",
            "description": "Root admin. Sees every Sector. Sector_id MUST be null.",
            "is_sector_scoped": False,
        },
        {
            "name": "colonel",
            "label": "Colonel",
            "description": "Sector admin. Full control inside one Sector.",
            "is_sector_scoped": True,
        },
        {
            "name": "captain",
            "label": "Captain",
            "description": "Data engineer / knowledge author inside a Sector.",
            "is_sector_scoped": True,
        },
        {
            "name": "soldier",
            "label": "Soldier",
            "description": "End user inside a Sector. Generates queries only.",
            "is_sector_scoped": True,
        },
    ]


# -----------------------------------------------------------------------------
# Cost summary (cross-tenant — General only)
# -----------------------------------------------------------------------------
class UserCostRow(BaseModel):
    user_id: str
    total_cost_usd: float
    total_queries: int
    total_tokens: int


@router.get("/users/cost-summary", response_model=List[UserCostRow])
async def users_cost_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_general),
):
    """Per-user spend across *all* sectors. Sector-scoped variants live under
    `/v1/sectors/{sid}/cost-summary` (Phase 6)."""
    stmt = (
        select(
            QueryHistory.user_id,
            func.coalesce(func.sum(QueryHistory.cost_usd), 0.0).label("total_cost_usd"),
            func.count(QueryHistory.id).label("total_queries"),
            func.coalesce(func.sum(QueryHistory.total_tokens), 0).label("total_tokens"),
        )
        .group_by(QueryHistory.user_id)
    )
    rows = (await db.execute(stmt)).all()
    return [
        UserCostRow(
            user_id=str(r.user_id),
            total_cost_usd=float(r.total_cost_usd or 0.0),
            total_queries=int(r.total_queries or 0),
            total_tokens=int(r.total_tokens or 0),
        )
        for r in rows
    ]
