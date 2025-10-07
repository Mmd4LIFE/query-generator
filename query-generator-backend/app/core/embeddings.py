"""
Embeddings processing and chunking
"""
import uuid
from typing import Any, Dict, List, Optional, Tuple

import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.openai_client import generate_embeddings
from app.core.qdrant_client import qdrant_store
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
        
        # Add entity_id if we have the table object
        if table_data["table"]:
            metadata["entity_id"] = str(table_data["table"].id)
        
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
            "entity_id": str(note.id),
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
            "entity_id": str(metric.id),
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
            "entity_id": str(example.id),
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
        try:
            # Phase 1: Delete from PostgreSQL (not committed yet)
            stmt = delete(Embedding).where(Embedding.catalog_id == catalog_id)
            result = await db.execute(stmt)
            deleted_count = result.rowcount
            
            # Phase 2: Delete from Qdrant (if this fails, PostgreSQL will rollback)
            await qdrant_store.delete_by_catalog(catalog_id)
            
            # Phase 3: Commit PostgreSQL transaction
            await db.commit()
            logger.info(
                "✅ Force delete successful - both databases in sync",
                catalog_id=catalog_id,
                deleted=deleted_count
            )
        except Exception as e:
            logger.error(
                "❌ Error during force delete - rolling back PostgreSQL transaction",
                error=str(e),
                catalog_id=catalog_id
            )
            await db.rollback()
            raise
    
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
    
    # Store embeddings with proper transaction handling
    created_count = 0
    updated_count = 0
    qdrant_points_to_insert = []  # Collect all Qdrant operations
    
    try:
        # Phase 1: Prepare PostgreSQL records (not committed yet)
        for (content, chunk_metadata), embedding in zip(all_chunks, embeddings):
            # Check if embedding already exists
            stmt = select(Embedding).where(
                Embedding.catalog_id == catalog_id,
                Embedding.content == content
            )
            result = await db.execute(stmt)
            existing = result.scalar_one_or_none()
            
            if existing:
                # Update existing in PostgreSQL
                existing.embedding_metadata = chunk_metadata
                
                # Update entity_id (polymorphic reference)
                if "entity_id" in chunk_metadata:
                    existing.entity_id = uuid.UUID(chunk_metadata["entity_id"])
                
                # Prepare Qdrant update
                qdrant_payload = {
                    "catalog_id": str(catalog_id),
                    "kind": chunk_metadata["kind"],
                    "metadata": chunk_metadata
                }
                qdrant_points_to_insert.append((existing.id, embedding, qdrant_payload))
                updated_count += 1
            else:
                # Create new in PostgreSQL
                db_embedding = Embedding(
                    content=content,
                    kind=chunk_metadata["kind"],
                    catalog_id=catalog_id,
                    embedding_metadata=chunk_metadata
                )
                
                # Set entity_id (polymorphic reference)
                if "entity_id" in chunk_metadata:
                    db_embedding.entity_id = uuid.UUID(chunk_metadata["entity_id"])
                
                db.add(db_embedding)
                await db.flush()  # Get the ID but DON'T commit yet
                
                # Prepare Qdrant insert
                qdrant_payload = {
                    "catalog_id": str(catalog_id),
                    "kind": chunk_metadata["kind"],
                    "metadata": chunk_metadata
                }
                qdrant_points_to_insert.append((db_embedding.id, embedding, qdrant_payload))
                created_count += 1
        
        # Phase 2: Insert all data to Qdrant (if this fails, PostgreSQL will rollback)
        logger.info("Inserting to Qdrant", count=len(qdrant_points_to_insert))
        point_ids = await qdrant_store.upsert_embeddings_batch(qdrant_points_to_insert)
        
        # Phase 3: Update PostgreSQL records with Qdrant point IDs
        for i, (embedding_id, _, _) in enumerate(qdrant_points_to_insert):
            stmt = select(Embedding).where(Embedding.id == embedding_id)
            result = await db.execute(stmt)
            embedding_record = result.scalar_one()
            embedding_record.qdrant_point_id = point_ids[i]
        
        # Phase 4: Commit PostgreSQL transaction (both DBs now in sync)
        await db.commit()
        logger.info(
            "✅ Transaction committed successfully - both databases in sync",
            catalog_id=catalog_id,
            created=created_count,
            updated=updated_count
        )
        
    except Exception as e:
        # Rollback PostgreSQL if Qdrant insertion fails
        logger.error(
            "❌ Error during embedding insertion - rolling back PostgreSQL transaction",
            error=str(e),
            catalog_id=catalog_id
        )
        await db.rollback()
        
        # Attempt to clean up any Qdrant points that may have been inserted
        if qdrant_points_to_insert:
            try:
                embedding_ids = [emb_id for emb_id, _, _ in qdrant_points_to_insert]
                await qdrant_store.delete_batch(embedding_ids)
                logger.info("Cleaned up Qdrant points after rollback", count=len(embedding_ids))
            except Exception as cleanup_error:
                logger.error("Failed to clean up Qdrant points", error=str(cleanup_error))
        
        raise  # Re-raise the original exception
    
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
    embedding_ids_to_delete = []
    
    try:
        # Phase 1: Collect all embeddings to delete (using polymorphic entity_id)
        for note in rejected_notes:
            stmt = select(Embedding).where(
                Embedding.entity_id == note.id,
                Embedding.kind == "note"
            )
            result = await db.execute(stmt)
            embeddings_to_delete = result.scalars().all()
            embedding_ids_to_delete.extend([emb.id for emb in embeddings_to_delete])
            
            stmt = delete(Embedding).where(
                Embedding.entity_id == note.id,
                Embedding.kind == "note"
            )
            result = await db.execute(stmt)
            deleted_count += result.rowcount
        
        for metric in rejected_metrics:
            stmt = select(Embedding).where(
                Embedding.entity_id == metric.id,
                Embedding.kind == "metric"
            )
            result = await db.execute(stmt)
            embeddings_to_delete = result.scalars().all()
            embedding_ids_to_delete.extend([emb.id for emb in embeddings_to_delete])
            
            stmt = delete(Embedding).where(
                Embedding.entity_id == metric.id,
                Embedding.kind == "metric"
            )
            result = await db.execute(stmt)
            deleted_count += result.rowcount
        
        for example in rejected_examples:
            stmt = select(Embedding).where(
                Embedding.entity_id == example.id,
                Embedding.kind == "example"
            )
            result = await db.execute(stmt)
            embeddings_to_delete = result.scalars().all()
            embedding_ids_to_delete.extend([emb.id for emb in embeddings_to_delete])
            
            stmt = delete(Embedding).where(
                Embedding.entity_id == example.id,
                Embedding.kind == "example"
            )
            result = await db.execute(stmt)
            deleted_count += result.rowcount
        
        # Phase 2: Delete from Qdrant (if this fails, PostgreSQL will rollback)
        if embedding_ids_to_delete:
            logger.info("Deleting from Qdrant", count=len(embedding_ids_to_delete))
            await qdrant_store.delete_batch(embedding_ids_to_delete)
        
        # Phase 3: Commit PostgreSQL transaction
        await db.commit()
        logger.info("✅ Deletion transaction committed - both databases in sync", deleted=deleted_count)
        
    except Exception as e:
        # Rollback PostgreSQL if Qdrant deletion fails
        logger.error(
            "❌ Error during embedding deletion - rolling back PostgreSQL transaction",
            error=str(e),
            catalog_id=catalog_id
        )
        await db.rollback()
        raise  # Re-raise the original exception
    
    logger.info(
        "Rejected embeddings cleaned up",
        catalog_id=catalog_id,
        deleted_count=deleted_count
    )
    
    return deleted_count 