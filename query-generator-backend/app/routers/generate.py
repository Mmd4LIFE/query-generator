"""
Query generation router
"""
import json
import time
import uuid
from typing import Dict

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.guardrails import apply_guardrails, validate_sql_syntax
from app.core.openai_client import generate_sql
from app.core.prompts import build_system_prompt, build_user_prompt, truncate_context
from app.core.retrieval import build_context_string, retrieve_context
from app.utils.sql_formatter import format_sql
from app.deps.auth import require_user, User
from app.deps.db import get_db
from app.models.catalog import Catalog
from app.models.history import QueryHistory
from app.models.policies import Policy
from app.schemas.generate import (
    GenerationRequest,
    GenerationResponse,
    PolicyInfo,
    ValidationInfo,
    ValidationRequest,
    ValidationResponse,
)

logger = structlog.get_logger()
router = APIRouter()


async def get_catalog_policy(db: AsyncSession, catalog_id: uuid.UUID) -> Dict:
    """Get policy for a catalog"""
    stmt = select(Policy).where(Policy.catalog_id == catalog_id)
    result = await db.execute(stmt)
    policy = result.scalar_one_or_none()
    
    if not policy:
        # Return default policy
        return {
            "allow_write": False,
            "default_limit": 1000,
            "banned_tables": [],
            "banned_columns": [],
            "banned_schemas": [],
            "pii_tags": [],
            "pii_masking_enabled": False,
            "max_rows_returned": None,
            "allowed_functions": None,
            "blocked_functions": None,
        }
    
    return {
        "allow_write": policy.allow_write,
        "default_limit": policy.default_limit,
        "banned_tables": policy.banned_tables or [],
        "banned_columns": policy.banned_columns or [],
        "banned_schemas": policy.banned_schemas or [],
        "pii_tags": policy.pii_tags or [],
        "pii_masking_enabled": policy.pii_masking_enabled,
        "max_rows_returned": policy.max_rows_returned,
        "allowed_functions": policy.allowed_functions,
        "blocked_functions": policy.blocked_functions,
    }


@router.post("/generate", response_model=GenerationResponse)
async def generate_query(
    request: GenerationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """
    Generate SQL query from natural language question.
    """
    start_time = time.time()
    
    logger.info(
        "Generating query",
        user_id=current_user.id,
        catalog_id=request.catalog_id,
        engine=request.engine,
        question_length=len(request.question)
    )
    
    # Get catalog
    stmt = select(Catalog).where(Catalog.id == request.catalog_id)
    result = await db.execute(stmt)
    catalog = result.scalar_one_or_none()
    
    if not catalog:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Catalog not found"
        )
    
    if not catalog.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Catalog is not active"
        )
    
    # Get policy
    policy = await get_catalog_policy(db, request.catalog_id)
    
    try:
        # Retrieve context
        context_chunks = await retrieve_context(
            db=db,
            question=request.question,
            catalog_id=request.catalog_id,
            include_schemas=request.include.schemas if request.include else None,
            include_tables=request.include.tables if request.include else None
        )
        
        # Build context string
        context_string = build_context_string(context_chunks)
        context_string = truncate_context(context_string, max_tokens=6000)
        
        # Build prompts
        system_prompt = build_system_prompt(
            dialect=request.engine,
            policy=policy,
            catalog_name=catalog.catalog_name
        )
        
        user_prompt = build_user_prompt(
            question=request.question,
            context=context_string,
            constraints=request.constraints,
            includes=request.include
        )
        
        # Generate SQL
        response_text, usage = await generate_sql(user_prompt, system_prompt)
        
        # Parse response
        try:
            response_json = json.loads(response_text)
            generated_sql = response_json.get("sql", "")
            explanation = response_json.get("explanation", "")
        except json.JSONDecodeError:
            logger.error("Failed to parse OpenAI response as JSON", response=response_text)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to parse generated response"
            )
        
        # Apply guardrails
        guardrails_result = apply_guardrails(generated_sql, policy, request.engine)
        
        # Format SQL with proper indentation and comment
        if guardrails_result.sql:
            guardrails_result.sql = format_sql(guardrails_result.sql, add_comment=True)
        
        # Build response
        validation_info = ValidationInfo(
            syntax_valid=guardrails_result.syntax_valid,
            errors=guardrails_result.errors,
            warnings=guardrails_result.warnings,
            parsed_tables=guardrails_result.parsed_tables,
            parsed_columns=guardrails_result.parsed_columns
        )
        
        policy_info = PolicyInfo(
            allow_write=policy["allow_write"],
            default_limit_applied="LIMIT" in guardrails_result.modifications,
            banned_items_blocked=guardrails_result.violations,
            pii_masking_applied=any("PII" in mod for mod in guardrails_result.modifications),
            violations=guardrails_result.violations
        )
        
        generation_time_ms = (time.time() - start_time) * 1000
        
        # Save to history
        history_entry = QueryHistory(
            user_id=current_user.id,
            catalog_id=request.catalog_id,
            engine=request.engine,
            question=request.question,
            constraints=request.constraints.dict() if request.constraints else None,
            generated_sql=guardrails_result.sql,
            explanation=explanation,
            syntax_valid=guardrails_result.syntax_valid,
            policy_violations={"violations": guardrails_result.violations} if guardrails_result.violations else None,
            guardrails_applied={"modifications": guardrails_result.modifications} if guardrails_result.modifications else None,
            model_used="gpt-4o",
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"),
            generation_time_ms=generation_time_ms,
            context_chunks=len(context_chunks),
            context_sources={
                "by_kind": {
                    kind: len([c for c in context_chunks if c["kind"] == kind])
                    for kind in set(c["kind"] for c in context_chunks)
                }
            } if context_chunks else None,
            status="success" if not guardrails_result.violations else "policy_violation"
        )
        
        db.add(history_entry)
        await db.commit()
        
        logger.info(
            "Query generated successfully",
            user_id=current_user.id,
            catalog_id=request.catalog_id,
            history_id=history_entry.id,
            generation_time_ms=generation_time_ms,
            syntax_valid=guardrails_result.syntax_valid,
            violations=len(guardrails_result.violations)
        )
        
        return GenerationResponse(
            sql=guardrails_result.sql if not guardrails_result.violations else None,
            explanation=explanation if not guardrails_result.violations else None,
            validation=validation_info,
            policy=policy_info,
            context_used=len(context_chunks),
            generation_time_ms=generation_time_ms,
            tokens_used=usage
        )
        
    except Exception as e:
        generation_time_ms = (time.time() - start_time) * 1000
        
        # Save error to history
        error_entry = QueryHistory(
            user_id=current_user.id,
            catalog_id=request.catalog_id,
            engine=request.engine,
            question=request.question,
            constraints=request.constraints.dict() if request.constraints else None,
            generation_time_ms=generation_time_ms,
            status="error",
            error_message=str(e)
        )
        
        db.add(error_entry)
        await db.commit()
        
        logger.error(
            "Query generation failed",
            user_id=current_user.id,
            catalog_id=request.catalog_id,
            error=str(e),
            generation_time_ms=generation_time_ms
        )
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query generation failed: {str(e)}"
        )


@router.post("/validate", response_model=ValidationResponse)
async def validate_query(
    request: ValidationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """
    Validate SQL query syntax and policies.
    """
    logger.info(
        "Validating query",
        user_id=current_user.id,
        engine=request.engine,
        sql_length=len(request.sql)
    )
    
    # Basic syntax validation
    syntax_result = validate_sql_syntax(request.sql, request.engine)
    
    validation_info = ValidationInfo(
        syntax_valid=syntax_result["syntax_valid"],
        errors=syntax_result["errors"],
        warnings=syntax_result["warnings"],
        parsed_tables=syntax_result["parsed_tables"],
        parsed_columns=syntax_result["parsed_columns"]
    )
    
    policy_info = None
    
    # If catalog ID is provided, also check policies
    if request.catalog_id:
        policy = await get_catalog_policy(db, request.catalog_id)
        guardrails_result = apply_guardrails(request.sql, policy, request.engine)
        
        policy_info = PolicyInfo(
            allow_write=policy["allow_write"],
            default_limit_applied=False,  # We're not modifying, just checking
            banned_items_blocked=guardrails_result.violations,
            pii_masking_applied=False,  # We're not modifying, just checking
            violations=guardrails_result.violations
        )
    
    return ValidationResponse(
        validation=validation_info,
        policy=policy_info
    ) 