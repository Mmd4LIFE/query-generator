"""
History router for query generation history and feedback
"""
import uuid
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import require_user, User
from app.deps.db import get_db
from app.models.history import QueryFeedback, QueryHistory

logger = structlog.get_logger()
router = APIRouter()


class HistoryResponse(BaseModel):
    """Query history response schema"""
    id: uuid.UUID
    catalog_id: uuid.UUID
    engine: str
    question: str
    generated_sql: Optional[str]
    explanation: Optional[str]
    syntax_valid: Optional[bool]
    status: str
    generation_time_ms: Optional[float]
    created_at: str
    tokens_used: Optional[int]

    class Config:
        from_attributes = True


class FeedbackCreate(BaseModel):
    """Feedback creation schema"""
    rating: Optional[int] = Field(None, ge=1, le=5)
    comment: Optional[str] = None
    correctness: Optional[int] = Field(None, ge=1, le=5)
    completeness: Optional[int] = Field(None, ge=1, le=5)
    efficiency: Optional[int] = Field(None, ge=1, le=5)
    suggested_sql: Optional[str] = None
    improvement_notes: Optional[str] = None


class FeedbackResponse(BaseModel):
    """Feedback response schema"""
    id: uuid.UUID
    history_id: uuid.UUID
    rating: Optional[int]
    comment: Optional[str]
    correctness: Optional[int]
    completeness: Optional[int]
    efficiency: Optional[int]
    suggested_sql: Optional[str]
    improvement_notes: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


class HistoryList(BaseModel):
    """History list response"""
    items: List[HistoryResponse]
    total: int
    limit: int
    offset: int


@router.get("", response_model=HistoryList)
async def get_history(
    catalog_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get query history for current user"""
    
    # Base query - users can only see their own history
    stmt = select(QueryHistory).where(QueryHistory.user_id == current_user.id)
    count_stmt = select(func.count(QueryHistory.id)).where(QueryHistory.user_id == current_user.id)
    
    # Apply filters
    if catalog_id:
        try:
            catalog_uuid = uuid.UUID(catalog_id)
            stmt = stmt.where(QueryHistory.catalog_id == catalog_uuid)
            count_stmt = count_stmt.where(QueryHistory.catalog_id == catalog_uuid)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid catalog_id format"
            )
    
    if status:
        stmt = stmt.where(QueryHistory.status == status)
        count_stmt = count_stmt.where(QueryHistory.status == status)
    
    # Get total count
    total_result = await db.execute(count_stmt)
    total = total_result.scalar()
    
    # Get items
    stmt = stmt.order_by(QueryHistory.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    histories = result.scalars().all()
    
    # Format response
    history_responses = []
    for history in histories:
        history_responses.append(HistoryResponse(
            id=history.id,
            catalog_id=history.catalog_id,
            engine=history.engine,
            question=history.question,
            generated_sql=history.generated_sql,
            explanation=history.explanation,
            syntax_valid=history.syntax_valid,
            status=history.status,
            generation_time_ms=history.generation_time_ms,
            created_at=history.created_at.isoformat(),
            tokens_used=history.total_tokens
        ))
    
    return HistoryList(
        items=history_responses,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/{history_id}", response_model=HistoryResponse)
async def get_history_item(
    history_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get specific history item"""
    
    stmt = select(QueryHistory).where(
        QueryHistory.id == history_id,
        QueryHistory.user_id == current_user.id  # Users can only see their own history
    )
    result = await db.execute(stmt)
    history = result.scalar_one_or_none()
    
    if not history:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History item not found"
        )
    
    return HistoryResponse(
        id=history.id,
        catalog_id=history.catalog_id,
        engine=history.engine,
        question=history.question,
        generated_sql=history.generated_sql,
        explanation=history.explanation,
        syntax_valid=history.syntax_valid,
        status=history.status,
        generation_time_ms=history.generation_time_ms,
        created_at=history.created_at.isoformat(),
        tokens_used=history.total_tokens
    )


@router.post("/{history_id}/feedback", response_model=FeedbackResponse)
async def create_feedback(
    history_id: uuid.UUID,
    feedback_create: FeedbackCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Create feedback for a history item"""
    
    # Verify the history item exists and belongs to the user
    stmt = select(QueryHistory).where(
        QueryHistory.id == history_id,
        QueryHistory.user_id == current_user.id
    )
    result = await db.execute(stmt)
    history = result.scalar_one_or_none()
    
    if not history:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History item not found"
        )
    
    # Check if feedback already exists
    stmt = select(QueryFeedback).where(
        QueryFeedback.history_id == history_id,
        QueryFeedback.user_id == current_user.id
    )
    result = await db.execute(stmt)
    existing_feedback = result.scalar_one_or_none()
    
    if existing_feedback:
        # Update existing feedback
        if feedback_create.rating is not None:
            existing_feedback.rating = feedback_create.rating
        if feedback_create.comment is not None:
            existing_feedback.comment = feedback_create.comment
        if feedback_create.correctness is not None:
            existing_feedback.correctness = feedback_create.correctness
        if feedback_create.completeness is not None:
            existing_feedback.completeness = feedback_create.completeness
        if feedback_create.efficiency is not None:
            existing_feedback.efficiency = feedback_create.efficiency
        if feedback_create.suggested_sql is not None:
            existing_feedback.suggested_sql = feedback_create.suggested_sql
        if feedback_create.improvement_notes is not None:
            existing_feedback.improvement_notes = feedback_create.improvement_notes
        
        await db.commit()
        await db.refresh(existing_feedback)
        
        logger.info(
            "Feedback updated",
            feedback_id=existing_feedback.id,
            history_id=history_id,
            user_id=current_user.id
        )
        
        feedback = existing_feedback
    else:
        # Create new feedback
        feedback = QueryFeedback(
            history_id=history_id,
            user_id=current_user.id,
            rating=feedback_create.rating,
            comment=feedback_create.comment,
            correctness=feedback_create.correctness,
            completeness=feedback_create.completeness,
            efficiency=feedback_create.efficiency,
            suggested_sql=feedback_create.suggested_sql,
            improvement_notes=feedback_create.improvement_notes
        )
        
        db.add(feedback)
        await db.commit()
        await db.refresh(feedback)
        
        logger.info(
            "Feedback created",
            feedback_id=feedback.id,
            history_id=history_id,
            user_id=current_user.id,
            rating=feedback_create.rating
        )
    
    return FeedbackResponse(
        id=feedback.id,
        history_id=feedback.history_id,
        rating=feedback.rating,
        comment=feedback.comment,
        correctness=feedback.correctness,
        completeness=feedback.completeness,
        efficiency=feedback.efficiency,
        suggested_sql=feedback.suggested_sql,
        improvement_notes=feedback.improvement_notes,
        created_at=feedback.created_at.isoformat()
    )


@router.get("/{history_id}/feedback", response_model=FeedbackResponse)
async def get_feedback(
    history_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get feedback for a history item"""
    
    # Verify the history item exists and belongs to the user
    stmt = select(QueryHistory).where(
        QueryHistory.id == history_id,
        QueryHistory.user_id == current_user.id
    )
    result = await db.execute(stmt)
    history = result.scalar_one_or_none()
    
    if not history:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History item not found"
        )
    
    # Get feedback
    stmt = select(QueryFeedback).where(
        QueryFeedback.history_id == history_id,
        QueryFeedback.user_id == current_user.id
    )
    result = await db.execute(stmt)
    feedback = result.scalar_one_or_none()
    
    if not feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feedback not found"
        )
    
    return FeedbackResponse(
        id=feedback.id,
        history_id=feedback.history_id,
        rating=feedback.rating,
        comment=feedback.comment,
        correctness=feedback.correctness,
        completeness=feedback.completeness,
        efficiency=feedback.efficiency,
        suggested_sql=feedback.suggested_sql,
        improvement_notes=feedback.improvement_notes,
        created_at=feedback.created_at.isoformat()
    )


@router.get("/{history_id}/feedback/all", response_model=List[FeedbackResponse])
async def get_all_feedback(
    history_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get all feedback for a history item"""
    
    # Verify the history item exists and belongs to the user
    stmt = select(QueryHistory).where(
        QueryHistory.id == history_id,
        QueryHistory.user_id == current_user.id
    )
    result = await db.execute(stmt)
    history = result.scalar_one_or_none()
    
    if not history:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History item not found"
        )
    
    # Get all feedback for this history item
    stmt = select(QueryFeedback).where(
        QueryFeedback.history_id == history_id
    ).order_by(QueryFeedback.created_at.desc())
    result = await db.execute(stmt)
    feedback_list = result.scalars().all()
    
    return [
        FeedbackResponse(
            id=feedback.id,
            history_id=feedback.history_id,
            rating=feedback.rating,
            comment=feedback.comment,
            correctness=feedback.correctness,
            completeness=feedback.completeness,
            efficiency=feedback.efficiency,
            suggested_sql=feedback.suggested_sql,
            improvement_notes=feedback.improvement_notes,
            created_at=feedback.created_at.isoformat()
        )
        for feedback in feedback_list
    ] 