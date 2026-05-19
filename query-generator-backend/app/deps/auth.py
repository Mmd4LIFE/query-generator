"""
Authentication & authorization dependencies.

Role vocabulary
---------------
    general  — root admin. sector_id IS NULL. Sees every sector.
    colonel  — sector admin. Owns one sector.
    captain  — data engineer inside a sector.
    soldier  — end user inside a sector.

Two-axis authorization:
    1. *Vertical*: which role tier is required for an action (`require_*`).
    2. *Horizontal*: which sector is the action scoped to (`current_sector`).

A General passes any horizontal check trivially. Everyone else must have an
active role for the specific sector named in the URL path.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import bcrypt
import structlog
from fastapi import Depends, HTTPException, Path, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.deps.db import get_db
from app.models.auth import User, UserRole
from app.models.sector import Sector

logger = structlog.get_logger()
security = HTTPBearer()

ROLE_PRIORITY: Dict[str, int] = {
    "general": 100,
    "colonel": 70,
    "captain": 40,
    "soldier": 10,
}

ALL_ROLES = frozenset(ROLE_PRIORITY.keys())


# -----------------------------------------------------------------------------
# Password helpers
# -----------------------------------------------------------------------------
def _truncate_for_bcrypt(password: str) -> bytes:
    """bcrypt accepts at most 72 bytes; truncate consistently for hash + verify."""
    encoded = password.encode("utf-8")
    return encoded[:72] if len(encoded) > 72 else encoded


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(_truncate_for_bcrypt(plain_password), hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(_truncate_for_bcrypt(password), bcrypt.gensalt()).decode("utf-8")


# -----------------------------------------------------------------------------
# JWT
# -----------------------------------------------------------------------------
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta if expires_delta else timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> Optional[uuid.UUID]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id: str = payload.get("sub")
        return uuid.UUID(user_id) if user_id else None
    except JWTError:
        return None


# -----------------------------------------------------------------------------
# User fetch
# -----------------------------------------------------------------------------
async def authenticate_user(db: AsyncSession, username: str, password: str) -> Optional[User]:
    stmt = select(User).where(User.username == username)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise credentials_exception

    stmt = select(User).options(selectinload(User.roles)).where(User.id == user_id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


# -----------------------------------------------------------------------------
# Role inspection
# -----------------------------------------------------------------------------
def active_role_rows(user: User) -> List[UserRole]:
    """All non-soft-deleted role rows for this user (any sector)."""
    return [r for r in user.roles if r.deleted_at is None]


def is_general(user: User) -> bool:
    return any(r.role_name == "general" and r.deleted_at is None for r in user.roles)


def role_in_sector(user: User, sector_id: uuid.UUID) -> Optional[str]:
    """Return the user's active role within `sector_id`, or None if no membership."""
    for r in user.roles:
        if r.deleted_at is None and r.sector_id == sector_id:
            return r.role_name
    return None


def effective_role(user: User, sector_id: Optional[uuid.UUID] = None) -> Optional[str]:
    """
    Highest-tier role applicable to the given sector.
    Generals dominate everywhere. For non-generals, only their explicit
    membership in `sector_id` counts.
    """
    if is_general(user):
        return "general"
    if sector_id is None:
        return None
    return role_in_sector(user, sector_id)


# -----------------------------------------------------------------------------
# Vertical role gates — tier-based (no sector scoping, see require_in_sector)
# -----------------------------------------------------------------------------
def _require_tier(min_role: str):
    """Return a dependency that demands at least `min_role` *somewhere*."""
    threshold = ROLE_PRIORITY[min_role]

    def _checker(user: User = Depends(get_current_active_user)) -> User:
        roles = active_role_rows(user)
        best = max((ROLE_PRIORITY.get(r.role_name, 0) for r in roles), default=0)
        if best < threshold:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{min_role}' or higher required",
            )
        return user

    return _checker


require_general = _require_tier("general")
require_colonel_anywhere = _require_tier("colonel")
require_captain_anywhere = _require_tier("captain")
require_soldier_anywhere = _require_tier("soldier")
# Convenience alias — every authenticated user with any role.
require_user = require_soldier_anywhere


# -----------------------------------------------------------------------------
# Horizontal scope — sector membership
# -----------------------------------------------------------------------------
@dataclass
class SectorContext:
    """Bundles a Sector with the caller's effective role in it."""
    sector: Sector
    role: str  # 'general' | 'colonel' | 'captain' | 'soldier'

    @property
    def is_general(self) -> bool:
        return self.role == "general"

    def has_at_least(self, role: str) -> bool:
        return ROLE_PRIORITY[self.role] >= ROLE_PRIORITY[role]


def _not_found() -> HTTPException:
    # 404, never 403, when the user has no business knowing the sector exists.
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sector not found")


async def current_sector(
    sector_id: uuid.UUID = Path(...),
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> SectorContext:
    """
    Resolve the URL's `{sector_id}` to a Sector and confirm the caller has
    membership. Generals pass for any active sector; everyone else needs a
    UserRole row pointing at this sector.
    """
    sector = (
        await db.execute(
            select(Sector).where(Sector.id == sector_id, Sector.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if not sector or not sector.is_active:
        raise _not_found()

    role = effective_role(user, sector_id)
    if role is None:
        raise _not_found()
    return SectorContext(sector=sector, role=role)


def require_in_sector(min_role: str):
    """
    Combined vertical+horizontal gate. The caller must (a) resolve to a
    sector via `current_sector` and (b) have at least `min_role` *within
    that sector* (Generals always pass).
    """

    def _checker(ctx: SectorContext = Depends(current_sector)) -> SectorContext:
        if ctx.is_general:
            return ctx
        if not ctx.has_at_least(min_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{min_role}' or higher required in this sector",
            )
        return ctx

    return _checker


# Shorthands used by routers.
require_sector_soldier = require_in_sector("soldier")
require_sector_captain = require_in_sector("captain")
require_sector_colonel = require_in_sector("colonel")
