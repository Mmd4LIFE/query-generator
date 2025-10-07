# Migration from pg_vector to Qdrant - Complete Guide

## Overview

This document describes the complete migration from using PostgreSQL's pg_vector extension to using Qdrant as a dedicated vector database for storing and querying embeddings.

## What Changed?

### Architecture Before (pg_vector)
```
PostgreSQL Database
├── dq_embeddings table
    ├── id (UUID)
    ├── content (TEXT)
    ├── embedding (VECTOR[3072]) ← Stored in PostgreSQL
    ├── kind (STRING)
    ├── catalog_id (UUID)
    └── metadata (JSON)
```

### Architecture After (Qdrant)
```
PostgreSQL Database              Qdrant Vector Database
├── dq_embeddings table          ├── embeddings collection
    ├── id (UUID) ─────────────────→ ├── Points (vectors)
    ├── content (TEXT)                    ├── id: UUID (from PostgreSQL)
    ├── qdrant_point_id (STRING)          ├── vector: [3072 floats]
    ├── kind (STRING)                     └── payload: metadata
    ├── catalog_id (UUID)
    └── metadata (JSON)
```

## Benefits of Qdrant

1. **Performance**: Purpose-built for vector similarity search
2. **Scalability**: Handles millions of vectors efficiently
3. **Advanced Features**: Better filtering, search options, and indexing
4. **Resource Isolation**: Vector operations don't impact PostgreSQL performance
5. **Easier Scaling**: Independent scaling of vector and relational databases

## Changes Made

### 1. Infrastructure (docker-compose.yml)
- **Changed**: PostgreSQL image from `pgvector/pgvector:pg16` to `postgres:16`
- **Added**: Qdrant service running on ports 6333 (HTTP) and 6334 (gRPC)
- **Added**: Qdrant volume for data persistence
- **Added**: Environment variables for Qdrant connection

### 2. Dependencies (pyproject.toml)
- **Removed**: `pgvector>=0.2.4`
- **Added**: `qdrant-client>=1.7.0`

### 3. Configuration (app/core/config.py)
- **Added**: Qdrant connection settings:
  - `qdrant_host` (default: localhost)
  - `qdrant_port` (default: 6333)
  - `qdrant_grpc_port` (default: 6334)
  - `qdrant_collection_name` (default: embeddings)
  - `qdrant_api_key` (optional, for production)

### 4. Database Schema (app/models/vector.py)
- **Removed**: `embedding` column (Vector type)
- **Added**: `qdrant_point_id` column (String, references Qdrant point)
- **Changed**: Model now stores only metadata, vectors are in Qdrant

### 5. New Qdrant Client (app/core/qdrant_client.py)
Created a comprehensive Qdrant wrapper with:
- **Collection Management**: Auto-creates collection with proper configuration
- **CRUD Operations**: 
  - `upsert_embedding()` - Insert/update single embedding
  - `upsert_embeddings_batch()` - Batch operations
  - `delete_by_catalog()` - Delete all embeddings for a catalog
  - `delete_by_id()` - Delete specific embedding
  - `delete_batch()` - Batch delete
  - `search_similar()` - Vector similarity search
- **Filtering**: Support for catalog_id, kind, schema, and table filters

### 6. Embeddings Processing (app/core/embeddings.py)
- **Modified**: `create_embeddings_for_catalog()` to:
  - Store vectors in Qdrant
  - Store metadata in PostgreSQL
  - Link them via `qdrant_point_id`
- **Modified**: `cleanup_rejected_embeddings()` to delete from both databases
- **Enhanced**: Force delete now cleans up Qdrant as well

### 7. Retrieval System (app/core/retrieval.py)
- **Completely Rewritten**: `retrieve_context()` to:
  - Generate query embedding
  - Search in Qdrant for similar vectors
  - Fetch metadata from PostgreSQL
  - Combine results for the application

### 8. Database Migration (app/migrations/versions/migrate_to_qdrant.py)
- **Drops**: pg_vector extension
- **Drops**: embedding column from dq_embeddings
- **Adds**: qdrant_point_id column with index

### 9. Database Initialization (init-db.sql)
- **Removed**: `CREATE EXTENSION IF NOT EXISTS vector;`

## How It Works

### Storing Embeddings

1. **Generate Embedding**: OpenAI API generates 3072-dimensional vector
2. **Store in PostgreSQL**: 
   - Create record in `dq_embeddings` with content and metadata
   - Get the UUID from PostgreSQL
3. **Store in Qdrant**:
   - Use PostgreSQL UUID as Qdrant point ID
   - Store vector with payload (catalog_id, kind, metadata)
4. **Link them**: Save Qdrant point ID back to PostgreSQL record

```python
# Example flow
embedding_record = Embedding(content="Table: users", kind="object", ...)
db.add(embedding_record)
await db.flush()  # Get the UUID

point_id = await qdrant_store.upsert_embedding(
    embedding_id=embedding_record.id,
    vector=[0.123, 0.456, ...],
    payload={"catalog_id": "...", "kind": "object"}
)
embedding_record.qdrant_point_id = point_id
await db.commit()
```

### Querying Embeddings

1. **Generate Query Embedding**: Convert question to vector
2. **Search Qdrant**: Find similar vectors with filtering
3. **Fetch Metadata**: Get full content from PostgreSQL using point IDs
4. **Return Results**: Combine vector scores with metadata

```python
# Example flow
query_vector = await embed_single_text("Show me user data")

qdrant_results = await qdrant_store.search_similar(
    query_vector=query_vector,
    catalog_id=catalog_id,
    limit=10
)

for result in qdrant_results:
    embedding = await db.get(Embedding, qdrant_point_id=result["point_id"])
    # Use embedding.content and embedding.metadata
```

## Migration Steps

### For New Installations

1. Clone the repository
2. Set environment variables (add to `.env`):
   ```bash
   QDRANT_HOST=qdrant
   QDRANT_PORT=6333
   QDRANT_COLLECTION_NAME=embeddings
   ```
3. Run: `docker-compose up -d`
4. Qdrant collection is auto-created on first run

### For Existing Installations

⚠️ **WARNING**: This migration will delete all existing embeddings!

1. **Backup your data** (optional):
   ```bash
   docker-compose exec postgres pg_dump -U qg qg > backup.sql
   ```

2. **Stop services**:
   ```bash
   docker-compose down
   ```

3. **Update code** (already done via git pull)

4. **Clean volumes** (optional, if you want fresh start):
   ```bash
   docker volume rm query-generator_postgres_data
   ```

5. **Start services**:
   ```bash
   docker-compose up -d
   ```

6. **Run migration**:
   ```bash
   docker-compose exec backend alembic upgrade head
   ```

7. **Re-index catalogs**: Go to the UI and reindex each catalog to regenerate embeddings in Qdrant

## Environment Variables

Add these to your `.env` file:

```bash
# Qdrant Configuration
QDRANT_HOST=qdrant                    # Host (use 'qdrant' in Docker, 'localhost' locally)
QDRANT_PORT=6333                      # HTTP API port
QDRANT_GRPC_PORT=6334                 # gRPC port (for better performance)
QDRANT_COLLECTION_NAME=embeddings     # Collection name
QDRANT_API_KEY=                       # Optional: API key for production deployment

# Existing variables (keep these)
POSTGRES_DB=qg
POSTGRES_USER=qg
POSTGRES_PASSWORD=qg
OPENAI_API_KEY=your_key_here
...
```

## Verification

After migration, verify everything works:

1. **Check Qdrant is running**:
   ```bash
   curl http://localhost:6333/
   # Should return Qdrant version info
   ```

2. **Check collection exists**:
   ```bash
   curl http://localhost:6333/collections/embeddings
   # Should return collection info
   ```

3. **Test in UI**:
   - Upload a catalog
   - Generate embeddings (click "Reindex")
   - Try generating a query
   - Verify results are returned

4. **Check logs**:
   ```bash
   docker-compose logs backend | grep -i qdrant
   # Should see successful Qdrant operations
   ```

## Troubleshooting

### Qdrant not connecting
- Check if Qdrant container is running: `docker-compose ps`
- Check Qdrant logs: `docker-compose logs qdrant`
- Verify environment variables are set correctly

### No search results
- Verify embeddings were created: Check Qdrant UI at http://localhost:6333/dashboard
- Check point count: `curl http://localhost:6333/collections/embeddings`
- Re-index your catalogs

### Migration fails
- Check if pg_vector extension exists: `docker-compose exec postgres psql -U qg -c "SELECT * FROM pg_extension WHERE extname='vector';"`
- If it doesn't exist, modify migration to skip the DROP EXTENSION step

## Performance Tips

1. **Batch Operations**: Use `upsert_embeddings_batch()` for bulk inserts
2. **Filtering**: Use catalog_id filtering to reduce search space
3. **Limit Results**: Set appropriate max_chunks to avoid over-fetching
4. **gRPC**: For production, consider using gRPC port (6334) for better performance

## Production Considerations

1. **API Key**: Set `QDRANT_API_KEY` for authentication
2. **Persistent Storage**: Ensure Qdrant volume is properly backed up
3. **Resource Limits**: Configure memory limits in docker-compose.yml
4. **Monitoring**: Monitor Qdrant metrics at `/metrics` endpoint
5. **Scaling**: Qdrant supports clustering for horizontal scaling

## Rollback Plan

If you need to rollback to pg_vector:

1. Stop services: `docker-compose down`
2. Checkout previous git commit: `git checkout <previous-commit>`
3. Restore database backup: `docker-compose exec postgres psql -U qg qg < backup.sql`
4. Start services: `docker-compose up -d`

## Support

For issues:
- Check Qdrant docs: https://qdrant.tech/documentation/
- Check logs: `docker-compose logs backend qdrant`
- Open an issue on GitHub

---

**Migration completed successfully! 🎉**

Your application now uses Qdrant for vector operations, providing better performance and scalability.

