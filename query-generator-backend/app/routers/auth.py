"""
Authentication router
"""
from datetime import datetime, timedelta
from typing import List

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.deps.auth import (
    authenticate_user,
    create_access_token,
    get_current_active_user,
    get_password_hash,
    get_user_roles,
    require_admin,
)
from app.deps.db import get_db
from app.models.auth import User, UserRole
from app.schemas.auth import (
    LoginRequest,
    Token,
    User as UserSchema,
    UserCreate,
    UserProfile,
    UserRoleCreate,
    UserUpdate,
    UserStatusUpdate,
    UserRole as UserRoleSchema,
)

logger = structlog.get_logger()
router = APIRouter()


@router.post("/login", response_model=Token)
async def login(
    login_request: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Authenticate user and return access token
    """
    user = await authenticate_user(db, login_request.username, login_request.password)
    if not user:
        logger.warning("Failed login attempt", username=login_request.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Update last login
    user.last_login = datetime.utcnow()
    await db.commit()
    
    # Create access token
    access_token_expires = timedelta(minutes=1440)  # 24 hours
    access_token = create_access_token(
        data={"sub": str(user.id)}, expires_delta=access_token_expires
    )
    
    logger.info("User logged in successfully", user_id=user.id, username=user.username)
    
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserProfile)
async def get_current_user_profile(
    current_user: User = Depends(get_current_active_user)
):
    """
    Get current user profile with single active role
    """
    from app.deps.auth import get_user_active_role
    
    # Get single active role instead of all roles
    active_role = get_user_active_role(current_user)
    
    return UserProfile(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        full_name=current_user.full_name,
        is_active=current_user.is_active,
        roles=[active_role],  # Single role in array for compatibility
        created_at=current_user.created_at,
        last_login=current_user.last_login,
    )


@router.post("/users", response_model=UserSchema)
async def create_user(
    user_create: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Create a new user (admin only)
    """
    # Check if username already exists
    stmt = select(User).where(User.username == user_create.username)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Check if email already exists
    stmt = select(User).where(User.email == user_create.email)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    hashed_password = get_password_hash(user_create.password)
    db_user = User(
        username=user_create.username,
        email=user_create.email,
        hashed_password=hashed_password,
        full_name=user_create.full_name,
        is_active=user_create.is_active,
    )
    
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    
    # Reload with roles relationship
    stmt = select(User).options(selectinload(User.roles)).where(User.id == db_user.id)
    result = await db.execute(stmt)
    db_user = result.scalar_one()
    
    logger.info(
        "User created",
        user_id=db_user.id,
        username=db_user.username,
        created_by=current_user.id
    )
    
    return db_user


@router.post("/users/{user_id}/roles", response_model=dict)
async def assign_user_role(
    user_id: str,
    role_create: UserRoleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Assign role to user (admin only) - Single Role System
    This will soft-delete any existing active roles and assign the new one
    """
    # Validate role
    valid_roles = ["admin", "data_guy", "user"]
    if role_create.role_name not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {valid_roles}"
        )
    
    # Check if user exists
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Single Role System: Soft delete all existing active roles
    from datetime import datetime
    stmt = select(UserRole).where(
        UserRole.user_id == user_id,
        UserRole.deleted_at.is_(None)
    )
    result = await db.execute(stmt)
    existing_roles = result.scalars().all()
    
    for existing_role in existing_roles:
        existing_role.deleted_at = datetime.utcnow()
        existing_role.updated_at = datetime.utcnow()
    
    # Check if this exact role is already the active role
    current_active_role = None
    if existing_roles:
        # Get the role that was just soft-deleted
        for role in existing_roles:
            if role.role_name == role_create.role_name and role.deleted_at:
                current_active_role = role.role_name
                break
    
    # Create new role assignment
    db_role = UserRole(
        user_id=user_id,
        role_name=role_create.role_name
    )
    
    db.add(db_role)
    await db.commit()
    
    logger.info(
        "Role assigned (single role system)",
        user_id=user_id,
        new_role=role_create.role_name,
        previous_roles=[role.role_name for role in existing_roles],
        assigned_by=current_user.id
    )
    
    return {"message": f"Role '{role_create.role_name}' assigned successfully"}


@router.get("/users", response_model=List[UserSchema])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    List all users with active roles only (admin only)
    """
    # Load users with roles (active roles will be filtered in the response)
    stmt = select(User).options(selectinload(User.roles)).order_by(User.created_at.desc())
    result = await db.execute(stmt)
    users = result.scalars().all()
    
    return users 


@router.put("/users/{user_id}", response_model=UserSchema)
async def update_user(
    user_id: str,
    user_update: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Update user information (admin only)
    """
    # Check if user exists
    stmt = select(User).options(selectinload(User.roles)).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Check for duplicate email if email is being updated
    if user_update.email and user_update.email != user.email:
        stmt = select(User).where(User.email == user_update.email)
        result = await db.execute(stmt)
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
    
    # Update fields
    if user_update.email is not None:
        user.email = user_update.email
    if user_update.full_name is not None:
        user.full_name = user_update.full_name
    if user_update.is_active is not None:
        user.is_active = user_update.is_active
    if user_update.password is not None:
        user.hashed_password = get_password_hash(user_update.password)
    
    user.updated_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(user)
    
    logger.info(
        "User updated",
        user_id=user.id,
        username=user.username,
        updated_by=current_user.id
    )
    
    return user


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Delete user (admin only)
    """
    # Check if user exists
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent admin from deleting themselves
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    
    username = user.username
    await db.delete(user)
    await db.commit()
    
    logger.info(
        "User deleted",
        user_id=user_id,
        username=username,
        deleted_by=current_user.id
    )
    
    return {
        "message": "User deleted successfully",
        "deleted_user_id": user_id
    }


@router.patch("/users/{user_id}/status")
async def toggle_user_status(
    user_id: str,
    status_update: UserStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Toggle user active status (admin only)
    """
    # Check if user exists
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Prevent admin from deactivating themselves
    if user.id == current_user.id and status_update.is_active == False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot deactivate your own account"
        )
    
    user.is_active = status_update.is_active
    user.updated_at = datetime.utcnow()
    
    await db.commit()
    
    logger.info(
        "User status updated",
        user_id=user_id,
        username=user.username,
        is_active=status_update.is_active,
        updated_by=current_user.id
    )
    
    return {
        "message": "User status updated successfully",
        "user_id": user_id,
        "is_active": status_update.is_active
    }


@router.get("/users/{user_id}/roles", response_model=List[UserRoleSchema])
async def get_user_roles_endpoint(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Get user active roles (admin only) - Single Role System
    """
    # Check if user exists and get roles (active roles filtered in response)
    stmt = select(User).options(selectinload(User.roles)).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return user.roles


@router.delete("/users/{user_id}/roles/{role_id}")
async def remove_user_role(
    user_id: str,
    role_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Remove role from user (admin only)
    """
    # Check if user exists
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Check if role assignment exists
    stmt = select(UserRole).where(
        UserRole.id == role_id,
        UserRole.user_id == user_id
    )
    result = await db.execute(stmt)
    role_assignment = result.scalar_one_or_none()
    if not role_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role assignment not found"
        )
    
    role_name = role_assignment.role_name
    await db.delete(role_assignment)
    await db.commit()
    
    logger.info(
        "Role removed",
        user_id=user_id,
        role_name=role_name,
        removed_by=current_user.id
    )
    
    return {
        "message": "Role removed successfully",
        "user_id": user_id,
        "role_name": role_name
    }


@router.get("/roles")
async def list_available_roles(
    current_user: User = Depends(require_admin)
):
    """
    List all available roles (admin only)
    """
    return [
        {
            "id": "role-1",
            "name": "admin",
            "description": "Full system access",
            "permissions": ["*"]
        },
        {
            "id": "role-2", 
            "name": "data_guy",
            "description": "Can manage catalogs and generate queries",
            "permissions": ["catalog:read", "catalog:write", "query:generate"]
        },
        {
            "id": "role-3",
            "name": "user", 
            "description": "Can generate queries only",
            "permissions": ["query:generate"]
        }
    ] 


@router.get("/users/{user_id}/role-history")
async def get_user_role_history(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Get user role history (admin only)
    """
    # Check if user exists
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Get all role assignments (active and deleted) for this user
    stmt = select(UserRole).where(UserRole.user_id == user_id).order_by(UserRole.created_at.desc())
    result = await db.execute(stmt)
    role_assignments = result.scalars().all()
    
    history = []
    for assignment in role_assignments:
        history.append({
            "role_name": assignment.role_name,
            "assigned_at": assignment.created_at,
            "removed_at": assignment.deleted_at,
            "status": "active" if assignment.deleted_at is None else "inactive"
        })
    
    return history 