"""
Authentication and authorization schemas
"""
import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, field_validator


class UserBase(BaseModel):
    """Base user schema"""
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    is_active: bool = True


class UserCreate(UserBase):
    """User creation schema"""
    password: str


class UserUpdate(BaseModel):
    """User update schema"""
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserStatusUpdate(BaseModel):
    """User status update schema"""
    is_active: bool


class UserRoleBase(BaseModel):
    """Base user role schema"""
    role_name: str


class UserRoleCreate(UserRoleBase):
    """User role creation schema"""
    user_id: uuid.UUID


class UserRole(UserRoleBase):
    """User role schema"""
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class User(UserBase):
    """User schema with active roles only"""
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None
    roles: List[UserRole] = []

    @field_validator('roles', mode='before')
    @classmethod
    def filter_active_roles(cls, v):
        """Filter out deleted roles"""
        if isinstance(v, list):
            return [role for role in v if role.deleted_at is None]
        return v

    class Config:
        from_attributes = True


class Token(BaseModel):
    """Token response schema"""
    access_token: str
    token_type: str


class TokenData(BaseModel):
    """Token data schema"""
    user_id: Optional[uuid.UUID] = None


class LoginRequest(BaseModel):
    """Login request schema"""
    username: str
    password: str


class UserProfile(BaseModel):
    """User profile schema"""
    id: uuid.UUID
    username: str
    email: EmailStr
    full_name: Optional[str] = None
    is_active: bool
    roles: List[str]
    created_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True 