"""
Query generation and validation schemas
"""
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class GenerationConstraints(BaseModel):
    """Generation constraints schema"""
    must_include_metrics: Optional[List[str]] = Field(
        None, 
        description="Metrics that must be included in the query"
    )
    time_range: Optional[str] = Field(
        None, 
        description="Time range hint (e.g., 'last_30d', 'this_month')"
    )
    max_rows: Optional[int] = Field(
        None, 
        ge=1, 
        le=100000, 
        description="Maximum number of rows to return"
    )
    include_totals: Optional[bool] = Field(
        None, 
        description="Whether to include total/aggregate rows"
    )
    group_by_period: Optional[str] = Field(
        None, 
        description="Grouping period (daily, weekly, monthly)"
    )


class GenerationIncludes(BaseModel):
    """Generation includes schema"""
    schemas: Optional[List[str]] = Field(
        None, 
        description="Specific schemas to focus on"
    )
    tables: Optional[List[str]] = Field(
        None, 
        description="Specific tables to focus on"
    )
    columns: Optional[List[str]] = Field(
        None, 
        description="Specific columns to focus on"
    )


class GenerationRequest(BaseModel):
    """Query generation request schema"""
    catalog_id: uuid.UUID = Field(..., description="Catalog ID to query against")
    engine: str = Field(..., description="SQL engine/dialect")
    question: str = Field(
        ..., 
        min_length=5, 
        max_length=1000, 
        description="Natural language question"
    )
    include: Optional[GenerationIncludes] = Field(
        None, 
        description="Objects to include in context"
    )
    constraints: Optional[GenerationConstraints] = Field(
        None, 
        description="Generation constraints"
    )


class ValidationInfo(BaseModel):
    """SQL validation information"""
    syntax_valid: bool = Field(..., description="Whether SQL syntax is valid")
    errors: Optional[List[str]] = Field(None, description="Validation errors")
    warnings: Optional[List[str]] = Field(None, description="Validation warnings")
    parsed_tables: Optional[List[str]] = Field(None, description="Tables found in SQL")
    parsed_columns: Optional[List[str]] = Field(None, description="Columns found in SQL")


class PolicyInfo(BaseModel):
    """Policy enforcement information"""
    allow_write: bool = Field(..., description="Whether writes are allowed")
    default_limit_applied: bool = Field(..., description="Whether default LIMIT was applied")
    banned_items_blocked: Optional[List[str]] = Field(
        None, 
        description="Banned items that were blocked"
    )
    pii_masking_applied: bool = Field(..., description="Whether PII masking was applied")
    violations: Optional[List[str]] = Field(None, description="Policy violations")


class GenerationResponse(BaseModel):
    """Query generation response schema"""
    sql: Optional[str] = Field(None, description="Generated SQL query")
    explanation: Optional[str] = Field(None, description="Query explanation")
    validation: ValidationInfo = Field(..., description="Validation results")
    policy: PolicyInfo = Field(..., description="Policy enforcement results")
    context_used: int = Field(..., description="Number of context chunks used")
    generation_time_ms: float = Field(..., description="Generation time in milliseconds")
    tokens_used: Optional[Dict[str, int]] = Field(None, description="Token usage statistics")


class ValidationRequest(BaseModel):
    """SQL validation request schema"""
    engine: str = Field(..., description="SQL engine/dialect")
    sql: str = Field(..., min_length=1, description="SQL query to validate")
    catalog_id: Optional[uuid.UUID] = Field(
        None, 
        description="Catalog ID for policy validation"
    )


class ValidationResponse(BaseModel):
    """SQL validation response schema"""
    validation: ValidationInfo = Field(..., description="Validation results")
    policy: Optional[PolicyInfo] = Field(None, description="Policy check results")


class GenerationError(BaseModel):
    """Generation error response schema"""
    error_type: str = Field(..., description="Type of error")
    message: str = Field(..., description="Error message")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional error details")


class GenerationStats(BaseModel):
    """Generation statistics schema"""
    total_requests: int
    successful_requests: int
    failed_requests: int
    avg_generation_time_ms: float
    avg_tokens_used: float
    most_common_engines: Dict[str, int]
    most_active_catalogs: Dict[str, int] 