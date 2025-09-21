"""
Authentication dependencies
"""
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.deps.db import get_db
from app.models.auth import User, UserRole

logger = structlog.get_logger()
security = HTTPBearer()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Role priority for single role system
ROLE_PRIORITY = {
    'admin': 100,
    'super_admin': 95,
    'data_guy': 50,
    'data_analyst': 45,
    'catalog_manager': 40,
    'user': 10,
    'viewer': 5
}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generate password hash"""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Create JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)
    return encoded_jwt


def decode_access_token(token: str):
    """Decode JWT access token"""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id: str = payload.get("sub")
        if user_id is None:
            return None
        return uuid.UUID(user_id)
    except JWTError:
        return None


async def authenticate_user(db: AsyncSession, username: str, password: str) -> Optional[User]:
    """Authenticate user with username and password"""
    stmt = select(User).where(User.username == username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Get current user from JWT token"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token = credentials.credentials
    user_id = decode_access_token(token)
    if user_id is None:
        raise credentials_exception
    
    # Load user with roles (we'll filter active roles in Python)
    stmt = select(User).options(selectinload(User.roles)).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    
    if user is None:
        raise credentials_exception
    
    return user


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """Get current active user"""
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


def get_user_roles(user: User) -> List[str]:
    """Get user role names (only active roles)"""
    return [role.role_name for role in user.roles if role.deleted_at is None]


def get_user_active_role(user: User) -> str:
    """Get user's current active role (highest priority)"""
    active_roles = [role.role_name for role in user.roles if role.deleted_at is None]
    
    if not active_roles:
        return 'user'  # Default role
    
    # Return the highest priority role
    return max(active_roles, key=lambda role: ROLE_PRIORITY.get(role, 0))


def require_role(required_role: str):
    """Dependency to require specific role"""
    def role_checker(current_user: User = Depends(get_current_active_user)) -> User:
        user_role = get_user_active_role(current_user)
        if user_role != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{required_role}' required"
            )
        return current_user
    return role_checker


def require_any_role(required_roles: List[str]):
    """Dependency to require any of the specified roles"""
    def role_checker(current_user: User = Depends(get_current_active_user)) -> User:
        user_role = get_user_active_role(current_user)
        if user_role not in required_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"One of roles {required_roles} required"
            )
        return current_user
    return role_checker


# Role-specific dependencies
require_admin = require_role("admin")
require_data_guy = require_any_role(["admin", "data_guy"])
require_user = require_any_role(["admin", "data_guy", "user"]) 