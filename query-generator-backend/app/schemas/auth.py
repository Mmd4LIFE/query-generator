"""
Authentication and authorization schemas.

Role vocabulary: general | colonel | captain | soldier.
"""
import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, field_validator


class UserBase(BaseModel):
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserStatusUpdate(BaseModel):
    is_active: bool


class UserRoleBase(BaseModel):
    role_name: str  # general | colonel | captain | soldier
    sector_id: Optional[uuid.UUID] = None  # required unless role_name == 'general'


class UserRoleCreate(UserRoleBase):
    user_id: Optional[uuid.UUID] = None  # carried in path on most endpoints


class UserRole(UserRoleBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class User(UserBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None
    roles: List[UserRole] = []

    @field_validator("roles", mode="before")
    @classmethod
    def filter_active_roles(cls, v):
        if isinstance(v, list):
            return [role for role in v if role.deleted_at is None]
        return v

    class Config:
        from_attributes = True


class SectorMembership(BaseModel):
    """A user's role inside one sector — embedded in the JWT for fast frontend rendering."""
    sector_id: uuid.UUID
    sector_code: str
    sector_name: str
    role: str  # colonel | captain | soldier


class Token(BaseModel):
    access_token: str
    token_type: str
    is_general: bool
    sectors: List[SectorMembership]


class TokenData(BaseModel):
    user_id: Optional[uuid.UUID] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class UserProfile(BaseModel):
    id: uuid.UUID
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    is_active: bool
    is_general: bool
    sectors: List[SectorMembership]
    created_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True
