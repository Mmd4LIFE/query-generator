"""
Knowledge management schemas (notes, metrics, examples)
"""
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class NoteBase(BaseModel):
    """Base note schema"""
    title: str = Field(..., max_length=255)
    content: str
    tags: Optional[List[str]] = None
    catalog_id: Optional[uuid.UUID] = None


class NoteCreate(NoteBase):
    """Note creation schema"""
    pass


class NoteUpdate(BaseModel):
    """Note update schema"""
    title: Optional[str] = Field(None, max_length=255)
    content: Optional[str] = None
    tags: Optional[List[str]] = None


class Note(NoteBase):
    """Note schema"""
    id: uuid.UUID
    status: str
    created_by: uuid.UUID
    approved_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MetricBase(BaseModel):
    """Base metric schema"""
    name: str = Field(..., max_length=255)
    description: str
    expression: str = Field(..., description="SQL expression template")
    engine: Optional[str] = Field(None, max_length=50)
    tags: Optional[List[str]] = None
    catalog_id: Optional[uuid.UUID] = None
    metric_metadata: Optional[Dict[str, Any]] = None


class MetricCreate(MetricBase):
    """Metric creation schema"""
    pass


class MetricUpdate(BaseModel):
    """Metric update schema"""
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    expression: Optional[str] = None
    engine: Optional[str] = Field(None, max_length=50)
    tags: Optional[List[str]] = None
    metric_metadata: Optional[Dict[str, Any]] = None


class Metric(MetricBase):
    """Metric schema"""
    id: uuid.UUID
    status: str
    created_by: uuid.UUID
    approved_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ExampleBase(BaseModel):
    """Base example schema"""
    title: str = Field(..., max_length=255)
    description: str
    sql_snippet: str
    engine: str = Field(..., max_length=50)
    tags: Optional[List[str]] = None
    catalog_id: Optional[uuid.UUID] = None
    example_metadata: Optional[Dict[str, Any]] = None


class ExampleCreate(ExampleBase):
    """Example creation schema"""
    pass


class ExampleUpdate(BaseModel):
    """Example update schema"""
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    sql_snippet: Optional[str] = None
    engine: Optional[str] = Field(None, max_length=50)
    tags: Optional[List[str]] = None
    example_metadata: Optional[Dict[str, Any]] = None


class Example(ExampleBase):
    """Example schema"""
    id: uuid.UUID
    status: str
    created_by: uuid.UUID
    approved_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ApprovalRequest(BaseModel):
    """Approval request schema"""
    action: str = Field(..., pattern="^(approve|reject)$")
    reason: Optional[str] = None


class ApprovalResponse(BaseModel):
    """Approval response schema"""
    id: uuid.UUID
    status: str
    approved_by: Optional[uuid.UUID]
    updated_at: datetime


class KnowledgeFilter(BaseModel):
    """Knowledge filtering schema"""
    status: Optional[str] = Field(None, pattern="^(pending|approved|rejected)$")
    catalog_id: Optional[uuid.UUID] = None
    tags: Optional[List[str]] = None
    created_by: Optional[uuid.UUID] = None
    limit: int = Field(default=50, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class KnowledgeList(BaseModel):
    """Knowledge list response schema"""
    items: List[Any]  # Will be List[Note], List[Metric], or List[Example]
    total: int
    limit: int
    offset: int 