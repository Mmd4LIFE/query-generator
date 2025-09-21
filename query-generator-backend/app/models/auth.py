"""
Authentication and authorization models
"""
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, String, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class User(Base, UUIDMixin, TimestampMixin):
    """User model"""
    __tablename__ = "auth_users"
    
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    roles: Mapped[List["UserRole"]] = relationship("UserRole", back_populates="user", cascade="all, delete-orphan")
    
    def __repr__(self) -> str:
        try:
            return f"<User(username='{self.username}', email='{self.email}')>"
        except Exception:
            return "<User(detached)>"


class UserRole(Base, UUIDMixin, TimestampMixin):
    """User role assignment model"""
    __tablename__ = "auth_user_roles"
    
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("auth_users.id"), nullable=False, index=True)
    role_name: Mapped[str] = mapped_column(String(50), nullable=False)  # admin, data_guy, user
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)  # Soft deletion
    
    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="roles")
    
    def __repr__(self) -> str:
        try:
            return f"<UserRole(user_id='{self.user_id}', role='{self.role_name}')>"
        except Exception:
            return "<UserRole(detached)>" 