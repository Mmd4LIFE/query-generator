"""
Knowledge management router (notes, metrics, examples)
"""
import uuid
from typing import List

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps.auth import require_admin, require_data_guy, require_user, User
from app.deps.db import get_db
from app.models.knowledge import Example, Metric, Note
from app.schemas.knowledge import (
    ApprovalRequest,
    ApprovalResponse,
    Example as ExampleSchema,
    ExampleCreate,
    KnowledgeFilter,
    KnowledgeList,
    Metric as MetricSchema,
    MetricCreate,
    Note as NoteSchema,
    NoteCreate,
)

logger = structlog.get_logger()
router = APIRouter()


# Notes endpoints
@router.post("/notes", response_model=NoteSchema)
async def create_note(
    note_create: NoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_data_guy)
):
    """Create a new note (data_guy+ role required)"""
    db_note = Note(
        title=note_create.title,
        content=note_create.content,
        tags=note_create.tags,
        catalog_id=note_create.catalog_id,
        created_by=current_user.id,
        status="pending"
    )
    
    db.add(db_note)
    await db.commit()
    await db.refresh(db_note)
    
    logger.info("Note created", note_id=db_note.id, created_by=current_user.id)
    return db_note


@router.get("/notes", response_model=List[NoteSchema])
async def list_notes(
    status: str = None,
    catalog_id: str = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """List notes with filtering"""
    stmt = select(Note)
    if status:
        stmt = stmt.where(Note.status == status)
    
    if catalog_id:
        stmt = stmt.where(Note.catalog_id == uuid.UUID(catalog_id))
    
    # Count total
    count_stmt = select(func.count(Note.id))
    if status:
        count_stmt = count_stmt.where(Note.status == status)
    if catalog_id:
        count_stmt = count_stmt.where(Note.catalog_id == uuid.UUID(catalog_id))
    
    total_result = await db.execute(count_stmt)
    total = total_result.scalar()
    
    # Get items
    stmt = stmt.order_by(Note.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    notes = result.scalars().all()
    
    return notes


@router.get("/notes/{note_id}", response_model=NoteSchema)
async def get_note(
    note_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get a specific note by ID"""
    stmt = select(Note).where(Note.id == note_id)
    result = await db.execute(stmt)
    note = result.scalar_one_or_none()
    
    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found"
        )
    
    return note


@router.post("/notes/{note_id}/approve", response_model=ApprovalResponse)
async def approve_note(
    note_id: uuid.UUID,
    approval: ApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Approve or reject a note (admin only)"""
    stmt = select(Note).where(Note.id == note_id)
    result = await db.execute(stmt)
    note = result.scalar_one_or_none()
    
    if not note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Note not found"
        )
    
    note.status = approval.action + "d"  # "approve" -> "approved", "reject" -> "rejected"
    note.approved_by = current_user.id
    
    await db.commit()
    await db.refresh(note)
    
    logger.info(
        "Note approval updated",
        note_id=note_id,
        status=note.status,
        approved_by=current_user.id
    )
    
    return ApprovalResponse(
        id=note.id,
        status=note.status,
        approved_by=note.approved_by,
        updated_at=note.updated_at
    )


# Metrics endpoints
@router.post("/metrics", response_model=MetricSchema)
async def create_metric(
    metric_create: MetricCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_data_guy)
):
    """Create a new metric (data_guy+ role required)"""
    db_metric = Metric(
        name=metric_create.name,
        description=metric_create.description,
        expression=metric_create.expression,
        engine=metric_create.engine,
        tags=metric_create.tags,
        catalog_id=metric_create.catalog_id,
        metric_metadata=metric_create.metric_metadata,
        created_by=current_user.id,
        status="pending"
    )
    
    db.add(db_metric)
    await db.commit()
    await db.refresh(db_metric)
    
    logger.info("Metric created", metric_id=db_metric.id, created_by=current_user.id)
    return db_metric


@router.get("/metrics", response_model=List[MetricSchema])
async def list_metrics(
    status: str = None,
    catalog_id: str = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """List metrics with filtering"""
    stmt = select(Metric)
    if status:
        stmt = stmt.where(Metric.status == status)
    
    if catalog_id:
        stmt = stmt.where(Metric.catalog_id == uuid.UUID(catalog_id))
    
    # Count total
    count_stmt = select(func.count(Metric.id))
    if status:
        count_stmt = count_stmt.where(Metric.status == status)
    if catalog_id:
        count_stmt = count_stmt.where(Metric.catalog_id == uuid.UUID(catalog_id))
    
    total_result = await db.execute(count_stmt)
    total = total_result.scalar()
    
    # Get items
    stmt = stmt.order_by(Metric.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    metrics = result.scalars().all()
    
    return metrics


@router.get("/metrics/{metric_id}", response_model=MetricSchema)
async def get_metric(
    metric_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get a specific metric by ID"""
    stmt = select(Metric).where(Metric.id == metric_id)
    result = await db.execute(stmt)
    metric = result.scalar_one_or_none()
    
    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Metric not found"
        )
    
    return metric


@router.post("/metrics/{metric_id}/approve", response_model=ApprovalResponse)
async def approve_metric(
    metric_id: uuid.UUID,
    approval: ApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Approve or reject a metric (admin only)"""
    stmt = select(Metric).where(Metric.id == metric_id)
    result = await db.execute(stmt)
    metric = result.scalar_one_or_none()
    
    if not metric:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Metric not found"
        )
    
    metric.status = approval.action + "d"
    metric.approved_by = current_user.id
    
    await db.commit()
    await db.refresh(metric)
    
    logger.info(
        "Metric approval updated",
        metric_id=metric_id,
        status=metric.status,
        approved_by=current_user.id
    )
    
    return ApprovalResponse(
        id=metric.id,
        status=metric.status,
        approved_by=metric.approved_by,
        updated_at=metric.updated_at
    )


# Examples endpoints
@router.post("/examples", response_model=ExampleSchema)
async def create_example(
    example_create: ExampleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_data_guy)
):
    """Create a new example (data_guy+ role required)"""
    db_example = Example(
        title=example_create.title,
        description=example_create.description,
        sql_snippet=example_create.sql_snippet,
        engine=example_create.engine,
        tags=example_create.tags,
        catalog_id=example_create.catalog_id,
        example_metadata=example_create.example_metadata,
        created_by=current_user.id,
        status="pending"
    )
    
    db.add(db_example)
    await db.commit()
    await db.refresh(db_example)
    
    logger.info("Example created", example_id=db_example.id, created_by=current_user.id)
    return db_example


@router.get("/examples", response_model=List[ExampleSchema])
async def list_examples(
    status: str = None,
    catalog_id: str = None,
    engine: str = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """List examples with filtering"""
    stmt = select(Example)
    if status:
        stmt = stmt.where(Example.status == status)
    
    if catalog_id:
        stmt = stmt.where(Example.catalog_id == uuid.UUID(catalog_id))
    
    if engine:
        stmt = stmt.where(Example.engine == engine)
    
    # Count total
    count_stmt = select(func.count(Example.id))
    if status:
        count_stmt = count_stmt.where(Example.status == status)
    if catalog_id:
        count_stmt = count_stmt.where(Example.catalog_id == uuid.UUID(catalog_id))
    if engine:
        count_stmt = count_stmt.where(Example.engine == engine)
    
    total_result = await db.execute(count_stmt)
    total = total_result.scalar()
    
    # Get items
    stmt = stmt.order_by(Example.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    examples = result.scalars().all()
    
    return examples


@router.get("/examples/{example_id}", response_model=ExampleSchema)
async def get_example(
    example_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_user)
):
    """Get a specific example by ID"""
    stmt = select(Example).where(Example.id == example_id)
    result = await db.execute(stmt)
    example = result.scalar_one_or_none()
    
    if not example:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Example not found"
        )
    
    return example


@router.post("/examples/{example_id}/approve", response_model=ApprovalResponse)
async def approve_example(
    example_id: uuid.UUID,
    approval: ApprovalRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """Approve or reject an example (admin only)"""
    stmt = select(Example).where(Example.id == example_id)
    result = await db.execute(stmt)
    example = result.scalar_one_or_none()
    
    if not example:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Example not found"
        )
    
    example.status = approval.action + "d"
    example.approved_by = current_user.id
    
    await db.commit()
    await db.refresh(example)
    
    logger.info(
        "Example approval updated",
        example_id=example_id,
        status=example.status,
        approved_by=current_user.id
    )
    
    return ApprovalResponse(
        id=example.id,
        status=example.status,
        approved_by=example.approved_by,
        updated_at=example.updated_at
    ) 