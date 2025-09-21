"""
Catalog and schema object models
"""
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, String, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class Catalog(Base, UUIDMixin, TimestampMixin):
    """Catalog model for storing uploaded schema snapshots"""
    __tablename__ = "dq_catalogs"
    
    engine: Mapped[str] = mapped_column(String(50), nullable=False)  # postgres, mysql, etc.
    catalog_name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    raw_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    
    # Relationships
    objects: Mapped[List["CatalogObject"]] = relationship(
        "CatalogObject", 
        back_populates="catalog",
        cascade="all, delete-orphan"
    )
    
    def __repr__(self) -> str:
        try:
            return f"<Catalog(name='{self.catalog_name}', engine='{self.engine}')>"
        except Exception:
            return "<Catalog(detached)>"


class CatalogObject(Base, UUIDMixin, TimestampMixin):
    """Flattened catalog objects (schemas, tables, columns)"""
    __tablename__ = "dq_objects"
    
    catalog_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("dq_catalogs.id"), nullable=False, index=True)
    object_type: Mapped[str] = mapped_column(String(20), nullable=False)  # schema, table, column
    schema_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    table_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    column_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    
    # Object properties
    data_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_nullable: Mapped[Optional[bool]] = mapped_column(nullable=True)
    is_primary_key: Mapped[Optional[bool]] = mapped_column(nullable=True)
    is_foreign_key: Mapped[Optional[bool]] = mapped_column(nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    # Additional metadata
    object_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    
    # Relationships
    catalog: Mapped["Catalog"] = relationship("Catalog", back_populates="objects")
    
    def __repr__(self) -> str:
        try:
            if self.object_type == "schema":
                return f"<CatalogObject(schema='{self.schema_name}')>"
            elif self.object_type == "table":
                return f"<CatalogObject(table='{self.schema_name}.{self.table_name}')>"
            else:
                return f"<CatalogObject(column='{self.schema_name}.{self.table_name}.{self.column_name}')>"
        except Exception:
            return "<CatalogObject(detached)>" 