"""
Authentication and authorization models.

Role vocabulary (see ROADMAP.md):
    general  — root admin (sector_id IS NULL)
    colonel  — sector admin
    captain  — data engineer in a sector
    soldier  — end user in a sector
"""
import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, func
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

    roles: Mapped[List["UserRole"]] = relationship(
        "UserRole", back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        try:
            return f"<User(username='{self.username}', email='{self.email}')>"
        except Exception:
            return "<User(detached)>"


class UserRole(Base, UUIDMixin, TimestampMixin):
    """
    A (user, sector, role) triple. A user has at most one active role per
    sector — enforced by a partial unique index in the migration. Generals
    have `sector_id IS NULL` (one global active row).
    """
    __tablename__ = "auth_user_roles"
    __table_args__ = (
        # Generals: sector_id IS NULL. Everyone else: sector_id IS NOT NULL.
        CheckConstraint(
            "(role_name = 'general' AND sector_id IS NULL) OR "
            "(role_name <> 'general' AND sector_id IS NOT NULL)",
            name="ck_general_has_no_sector",
        ),
        Index(
            "uq_user_active_role_per_sector",
            "user_id",
            "sector_id",
            unique=True,
            postgresql_where=(
                "deleted_at IS NULL"
            ),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sector_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dq_sectors.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    role_name: Mapped[str] = mapped_column(String(50), nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="roles")

    def __repr__(self) -> str:
        try:
            return f"<UserRole(user_id='{self.user_id}', sector_id='{self.sector_id}', role='{self.role_name}')>"
        except Exception:
            return "<UserRole(detached)>"
