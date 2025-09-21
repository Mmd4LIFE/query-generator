"""
Catalog and schema object schemas
"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CatalogObjectBase(BaseModel):
    """Base catalog object schema"""
    object_type: str
    schema_name: Optional[str] = None
    table_name: Optional[str] = None
    column_name: Optional[str] = None
    data_type: Optional[str] = None
    is_nullable: Optional[bool] = None
    is_primary_key: Optional[bool] = None
    is_foreign_key: Optional[bool] = None
    comment: Optional[str] = None
    object_metadata: Optional[Dict[str, Any]] = None


class CatalogObject(CatalogObjectBase):
    """Catalog object schema"""
    id: uuid.UUID
    catalog_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CatalogBase(BaseModel):
    """Base catalog schema"""
    engine: str = Field(..., description="Database engine (postgres, mysql, etc.)")
    catalog_name: str = Field(..., description="Catalog name")
    version: Optional[str] = Field(None, description="Version identifier")
    description: Optional[str] = None
    is_active: bool = True


class CatalogCreate(CatalogBase):
    """Catalog creation schema"""
    raw_json: Dict[str, Any] = Field(..., description="Raw catalog JSON")


class CatalogUpdate(BaseModel):
    """Catalog update schema"""
    description: Optional[str] = None
    is_active: Optional[bool] = None


class Catalog(CatalogBase):
    """Catalog schema"""
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    objects: List[CatalogObject] = []

    class Config:
        from_attributes = True


class CatalogSummary(BaseModel):
    """Catalog summary schema"""
    id: uuid.UUID
    engine: str
    catalog_name: str
    version: Optional[str]
    description: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    object_counts: Dict[str, int] = Field(default_factory=dict)

    class Config:
        from_attributes = True


class CatalogReindexRequest(BaseModel):
    """Catalog reindex request schema"""
    force: bool = Field(default=False, description="Force reindex even if embeddings exist")


class CatalogReindexResponse(BaseModel):
    """Catalog reindex response schema"""
    catalog_id: uuid.UUID
    status: str
    embeddings_created: int
    embeddings_updated: int
    processing_time_seconds: float


# Catalog JSON format schemas (for validation)
class ColumnSchema(BaseModel):
    """Column schema for catalog JSON"""
    name: str
    data_type: str
    nullable: bool = True
    default: Optional[str] = None
    comment: Optional[str] = None


class IndexSchema(BaseModel):
    """Index schema for catalog JSON"""
    name: str
    columns: List[str]
    unique: bool = False


class ForeignKeySchema(BaseModel):
    """Foreign key schema for catalog JSON"""
    columns: List[str]
    ref_schema: str
    ref_table: str
    ref_columns: List[str]


class TableSchema(BaseModel):
    """Table schema for catalog JSON"""
    name: str
    type: str = "table"  # table, view, materialized_view
    comment: Optional[str] = None
    primary_key: List[str] = Field(default_factory=list)
    foreign_keys: List[ForeignKeySchema] = Field(default_factory=list)
    indexes: List[IndexSchema] = Field(default_factory=list)
    columns: List[ColumnSchema]


class SchemaSchema(BaseModel):
    """Schema schema for catalog JSON"""
    name: str
    tables: List[TableSchema]


class CatalogJsonSchema(BaseModel):
    """Complete catalog JSON schema for validation"""
    engine: str
    catalog_name: str
    version: str
    schemas: List[SchemaSchema] 