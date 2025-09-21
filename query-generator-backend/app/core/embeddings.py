"""
Embeddings processing and chunking
"""
import uuid
from typing import Any, Dict, List, Optional, Tuple

import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.openai_client import generate_embeddings
from app.models.catalog import Catalog, CatalogObject
from app.models.knowledge import Example, Metric, Note
from app.models.vector import Embedding

logger = structlog.get_logger()


def create_table_chunk(
    catalog_name: str,
    schema_name: str,
    table_name: str,
    columns: List[CatalogObject],
    comment: Optional[str] = None
) -> str:
    """
    Create a text chunk for a table with its columns.
    
    Args:
        catalog_name: Name of the catalog
        schema_name: Schema name
        table_name: Table name
        columns: List of column objects
        comment: Table comment
        
    Returns:
        Formatted text chunk
    """
    chunk_parts = [
        f"Table: {schema_name}.{table_name}",
        f"Catalog: {catalog_name}"
    ]
    
    if comment:
        chunk_parts.append(f"Description: {comment}")
    
    # Add primary keys
    pk_columns = [col.column_name for col in columns if col.is_primary_key]
    if pk_columns:
        chunk_parts.append(f"Primary Key: {', '.join(pk_columns)}")
    
    # Add foreign keys
    fk_columns = [col.column_name for col in columns if col.is_foreign_key]
    if fk_columns:
        chunk_parts.append(f"Foreign Keys: {', '.join(fk_columns)}")
    
    # Add column details
    chunk_parts.append("Columns:")
    for col in columns:
        col_desc = f"  - {col.column_name} ({col.data_type})"
        if not col.is_nullable:
            col_desc += " NOT NULL"
        if col.comment:
            col_desc += f" -- {col.comment}"
        chunk_parts.append(col_desc)
    
    return "\n".join(chunk_parts)


def create_note_chunk(note: Note) -> str:
    """Create a text chunk for a note."""
    chunk_parts = [
        f"Note: {note.title}",
        f"Content: {note.content}"
    ]
    
    if note.tags:
        chunk_parts.append(f"Tags: {', '.join(note.tags)}")
    
    return "\n".join(chunk_parts)


def create_metric_chunk(metric: Metric) -> str:
    """Create a text chunk for a metric."""
    chunk_parts = [
        f"Metric: {metric.name}",
        f"Description: {metric.description}",
        f"Expression: {metric.expression}"
    ]
    
    if metric.engine:
        chunk_parts.append(f"Engine: {metric.engine}")
    
    if metric.tags:
        chunk_parts.append(f"Tags: {', '.join(metric.tags)}")
    
    return "\n".join(chunk_parts)


def create_example_chunk(example: Example) -> str:
    """Create a text chunk for an example."""
    chunk_parts = [
        f"Example: {example.title}",
        f"Description: {example.description}",
        f"Engine: {example.engine}",
        f"SQL: {example.sql_snippet}"
    ]
    
    if example.tags:
        chunk_parts.append(f"Tags: {', '.join(example.tags)}")
    
    return "\n".join(chunk_parts)


async def process_catalog_objects(
    db: AsyncSession,
    catalog: Catalog
) -> List[Tuple[str, Dict[str, Any]]]:
    """
    Process catalog objects into text chunks for embedding.
    
    Args:
        db: Database session
        catalog: Catalog to process
        
    Returns:
        List of (content, metadata) tuples
    """
    logger.info("Processing catalog objects", catalog_id=catalog.id)
    
    # Get all objects for this catalog
    stmt = select(CatalogObject).where(CatalogObject.catalog_id == catalog.id)
    result = await db.execute(stmt)
    objects = result.scalars().all()
    
    # Group objects by table
    tables = {}
    for obj in objects:
        if obj.object_type == "table":
            key = (obj.schema_name, obj.table_name)
            if key not in tables:
                tables[key] = {"table": obj, "columns": []}
        elif obj.object_type == "column":
            key = (obj.schema_name, obj.table_name)
            if key not in tables:
                tables[key] = {"table": None, "columns": []}
            tables[key]["columns"].append(obj)
    
    # Create chunks for each table
    chunks = []
    for (schema_name, table_name), table_data in tables.items():
        if not table_data["columns"]:
            continue
            
        content = create_table_chunk(
            catalog.catalog_name,
            schema_name,
            table_name,
            table_data["columns"],
            table_data["table"].comment if table_data["table"] else None
        )
        
        metadata = {
            "catalog_id": str(catalog.id),
            "kind": "object",
            "schema": schema_name,
            "table": table_name,
            "object_type": "table"
        }
        
        chunks.append((content, metadata))
    
    logger.info("Created table chunks", count=len(chunks))
    return chunks


async def process_knowledge_items(
    db: AsyncSession,
    catalog_id: Optional[uuid.UUID] = None
) -> List[Tuple[str, Dict[str, Any]]]:
    """
    Process approved knowledge items into text chunks.
    
    Args:
        db: Database session
        catalog_id: Optional catalog ID to filter by
        
    Returns:
        List of (content, metadata) tuples
    """
    chunks = []
    
    # Process notes (only approved notes for embeddings)
    stmt = select(Note).where(Note.status == "approved")
    if catalog_id:
        stmt = stmt.where(Note.catalog_id == catalog_id)
    result = await db.execute(stmt)
    notes = result.scalars().all()
    
    for note in notes:
        content = create_note_chunk(note)
        metadata = {
            "catalog_id": str(note.catalog_id) if note.catalog_id else None,
            "kind": "note",
            "note_id": str(note.id),
            "title": note.title
        }
        chunks.append((content, metadata))
    
    # Process metrics (only approved metrics for embeddings)
    stmt = select(Metric).where(Metric.status == "approved")
    if catalog_id:
        stmt = stmt.where(Metric.catalog_id == catalog_id)
    result = await db.execute(stmt)
    metrics = result.scalars().all()
    
    for metric in metrics:
        content = create_metric_chunk(metric)
        metadata = {
            "catalog_id": str(metric.catalog_id) if metric.catalog_id else None,
            "kind": "metric",
            "metric_id": str(metric.id),
            "name": metric.name
        }
        chunks.append((content, metadata))
    
    # Process examples (only approved examples for embeddings)
    stmt = select(Example).where(Example.status == "approved")
    if catalog_id:
        stmt = stmt.where(Example.catalog_id == catalog_id)
    result = await db.execute(stmt)
    examples = result.scalars().all()
    
    for example in examples:
        content = create_example_chunk(example)
        metadata = {
            "catalog_id": str(example.catalog_id) if example.catalog_id else None,
            "kind": "example",
            "example_id": str(example.id),
            "title": example.title,
            "engine": example.engine
        }
        chunks.append((content, metadata))
    
    logger.info("Created knowledge chunks", count=len(chunks))
    return chunks


async def create_embeddings_for_catalog(
    db: AsyncSession,
    catalog_id: uuid.UUID,
    force: bool = False
) -> Tuple[int, int]:
    """
    Create embeddings for a catalog and its knowledge items.
    
    Args:
        db: Database session
        catalog_id: Catalog ID
        force: Whether to recreate existing embeddings
        
    Returns:
        Tuple of (created_count, updated_count)
    """
    logger.info("Creating embeddings for catalog", catalog_id=catalog_id, force=force)
    
    # Get catalog
    stmt = select(Catalog).where(Catalog.id == catalog_id)
    result = await db.execute(stmt)
    catalog = result.scalar_one_or_none()
    if not catalog:
        raise ValueError(f"Catalog {catalog_id} not found")
    
    # Delete existing embeddings if force is True
    if force:
        stmt = delete(Embedding).where(Embedding.catalog_id == catalog_id)
        await db.execute(stmt)
        await db.commit()
        logger.info("Deleted existing embeddings", catalog_id=catalog_id)
    
    # Always clean up rejected embeddings
    deleted_count = await cleanup_rejected_embeddings(db, catalog_id)
    
    # Get all chunks to embed
    object_chunks = await process_catalog_objects(db, catalog)
    knowledge_chunks = await process_knowledge_items(db, catalog_id)
    all_chunks = object_chunks + knowledge_chunks
    
    if not all_chunks:
        logger.warning("No chunks to embed", catalog_id=catalog_id)
        return 0, 0
    
    # Generate embeddings
    contents = [chunk[0] for chunk in all_chunks]
    embeddings = await generate_embeddings(contents)
    
    if len(embeddings) != len(all_chunks):
        raise ValueError("Embedding count mismatch")
    
    # Store embeddings
    created_count = 0
    updated_count = 0
    
    for (content, chunk_metadata), embedding in zip(all_chunks, embeddings):
        # Check if embedding already exists
        stmt = select(Embedding).where(
            Embedding.catalog_id == catalog_id,
            Embedding.content == content
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        
        if existing:
            # Update existing
            existing.embedding = embedding
            existing.embedding_metadata = chunk_metadata
            updated_count += 1
        else:
            # Create new
            db_embedding = Embedding(
                content=content,
                embedding=embedding,
                kind=chunk_metadata["kind"],
                catalog_id=catalog_id,
                embedding_metadata=chunk_metadata
            )
            
            # Set specific ID references based on kind
            if chunk_metadata["kind"] == "note" and "note_id" in chunk_metadata:
                db_embedding.note_id = uuid.UUID(chunk_metadata["note_id"])
            elif chunk_metadata["kind"] == "metric" and "metric_id" in chunk_metadata:
                db_embedding.metric_id = uuid.UUID(chunk_metadata["metric_id"])
            elif chunk_metadata["kind"] == "example" and "example_id" in chunk_metadata:
                db_embedding.example_id = uuid.UUID(chunk_metadata["example_id"])
            
            db.add(db_embedding)
            created_count += 1
    
    await db.commit()
    
    logger.info(
        "Embeddings created/updated",
        catalog_id=catalog_id,
        created=created_count,
        updated=updated_count
    )
    
    return created_count, updated_count


async def cleanup_rejected_embeddings(
    db: AsyncSession,
    catalog_id: uuid.UUID
) -> int:
    """
    Remove embeddings for rejected knowledge items.
    
    Args:
        db: Database session
        catalog_id: Catalog ID to clean up
        
    Returns:
        Number of embeddings deleted
    """
    logger.info("Cleaning up rejected embeddings", catalog_id=catalog_id)
    
    # Get all rejected notes for this catalog
    stmt = select(Note).where(
        Note.catalog_id == catalog_id,
        Note.status.in_(["rejected", "rejectd"])  # Handle typo in status
    )
    result = await db.execute(stmt)
    rejected_notes = result.scalars().all()
    
    # Get all rejected metrics for this catalog
    stmt = select(Metric).where(
        Metric.catalog_id == catalog_id,
        Metric.status.in_(["rejected", "rejectd"])
    )
    result = await db.execute(stmt)
    rejected_metrics = result.scalars().all()
    
    # Get all rejected examples for this catalog
    stmt = select(Example).where(
        Example.catalog_id == catalog_id,
        Example.status.in_(["rejected", "rejectd"])
    )
    result = await db.execute(stmt)
    rejected_examples = result.scalars().all()
    
    deleted_count = 0
    
    # Delete embeddings for rejected notes
    for note in rejected_notes:
        stmt = delete(Embedding).where(Embedding.note_id == note.id)
        result = await db.execute(stmt)
        deleted_count += result.rowcount
    
    # Delete embeddings for rejected metrics
    for metric in rejected_metrics:
        stmt = delete(Embedding).where(Embedding.metric_id == metric.id)
        result = await db.execute(stmt)
        deleted_count += result.rowcount
    
    # Delete embeddings for rejected examples
    for example in rejected_examples:
        stmt = delete(Embedding).where(Embedding.example_id == example.id)
        result = await db.execute(stmt)
        deleted_count += result.rowcount
    
    await db.commit()
    
    logger.info(
        "Rejected embeddings cleaned up",
        catalog_id=catalog_id,
        deleted_count=deleted_count
    )
    
    return deleted_count 