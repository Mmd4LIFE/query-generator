# Transaction Handling Between PostgreSQL and Qdrant

## Problem Statement

When working with two databases (PostgreSQL for metadata and Qdrant for vectors), we need to ensure **ACID-like consistency** across both systems. If one database operation fails, the other should rollback to maintain data integrity.

## Challenge

Unlike traditional ACID transactions that work within a single database, we're dealing with:
- **PostgreSQL**: ACID-compliant relational database
- **Qdrant**: Vector database (separate system)
- **No distributed transaction coordinator** (no 2PC protocol)

## Our Solution: Compensating Transactions

We implement a **two-phase commit pattern** with compensating transactions:

### Phase 1: Prepare (PostgreSQL)
- Insert/update records in PostgreSQL
- Use `flush()` to get IDs but **DON'T commit yet**
- Transaction remains open

### Phase 2: Execute (Qdrant)
- Insert vectors into Qdrant using PostgreSQL IDs
- If this **succeeds** → proceed to Phase 3
- If this **fails** → trigger rollback

### Phase 3: Commit (PostgreSQL)
- Update PostgreSQL records with Qdrant point IDs
- Commit PostgreSQL transaction
- Both databases now in sync ✅

### Phase 4: Rollback (on failure)
- Rollback PostgreSQL transaction
- Attempt cleanup of any Qdrant points (compensating transaction)

---

## Code Implementation

### 1. Insertion with Transaction Handling

```python
async def create_embeddings_for_catalog(db: AsyncSession, catalog_id: uuid.UUID):
    created_count = 0
    qdrant_points_to_insert = []
    
    try:
        # PHASE 1: Prepare PostgreSQL (not committed)
        for content, embedding, metadata in data:
            db_record = Embedding(content=content, ...)
            db.add(db_record)
            await db.flush()  # Get ID but DON'T commit
            
            qdrant_points_to_insert.append((db_record.id, embedding, metadata))
            created_count += 1
        
        # PHASE 2: Insert to Qdrant (critical point)
        point_ids = await qdrant_store.upsert_embeddings_batch(qdrant_points_to_insert)
        
        # PHASE 3: Update PostgreSQL with Qdrant IDs
        for i, (embedding_id, _, _) in enumerate(qdrant_points_to_insert):
            record = await db.get(Embedding, embedding_id)
            record.qdrant_point_id = point_ids[i]
        
        # PHASE 4: Commit (both DBs now in sync)
        await db.commit()
        logger.info("✅ Transaction successful - both databases in sync")
        
    except Exception as e:
        # ROLLBACK: PostgreSQL transaction
        logger.error("❌ Error detected - rolling back")
        await db.rollback()
        
        # COMPENSATE: Clean up Qdrant if needed
        if qdrant_points_to_insert:
            embedding_ids = [id for id, _, _ in qdrant_points_to_insert]
            await qdrant_store.delete_batch(embedding_ids)
        
        raise  # Re-raise to notify caller
```

### 2. Deletion with Transaction Handling

```python
async def cleanup_rejected_embeddings(db: AsyncSession, catalog_id: uuid.UUID):
    embedding_ids_to_delete = []
    
    try:
        # PHASE 1: Delete from PostgreSQL (not committed)
        for item in rejected_items:
            embeddings = await db.execute(
                select(Embedding).where(Embedding.item_id == item.id)
            )
            embedding_ids_to_delete.extend([e.id for e in embeddings])
            
            await db.execute(delete(Embedding).where(Embedding.item_id == item.id))
        
        # PHASE 2: Delete from Qdrant (critical point)
        if embedding_ids_to_delete:
            await qdrant_store.delete_batch(embedding_ids_to_delete)
        
        # PHASE 3: Commit PostgreSQL
        await db.commit()
        logger.info("✅ Deletion successful - both databases in sync")
        
    except Exception as e:
        # ROLLBACK: PostgreSQL transaction
        logger.error("❌ Error during deletion - rolling back")
        await db.rollback()
        raise
```

---

## Flow Diagrams

### Success Scenario

```
┌─────────────┐                    ┌─────────────┐
│ PostgreSQL  │                    │   Qdrant    │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. BEGIN TRANSACTION             │
       ├─────────────────────────>        │
       │                                  │
       │ 2. INSERT (not committed)        │
       ├─────────────────────────>        │
       │                                  │
       │ 3. FLUSH (get IDs)               │
       │<─────────────────────────        │
       │                                  │
       │         4. INSERT VECTORS        │
       │         ──────────────────────>  │
       │                                  │
       │         5. SUCCESS ✅             │
       │         <──────────────────────  │
       │                                  │
       │ 6. UPDATE with point IDs         │
       ├─────────────────────────>        │
       │                                  │
       │ 7. COMMIT ✅                      │
       ├─────────────────────────>        │
       │                                  │
       │         Both DBs in sync ✅       │
```

### Failure Scenario (Qdrant Fails)

```
┌─────────────┐                    ┌─────────────┐
│ PostgreSQL  │                    │   Qdrant    │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ 1. BEGIN TRANSACTION             │
       ├─────────────────────────>        │
       │                                  │
       │ 2. INSERT (not committed)        │
       ├─────────────────────────>        │
       │                                  │
       │ 3. FLUSH (get IDs)               │
       │<─────────────────────────        │
       │                                  │
       │         4. INSERT VECTORS        │
       │         ──────────────────────>  │
       │                                  │
       │         5. ERROR ❌               │
       │         <──────────────────────  │
       │                                  │
       │ 6. ROLLBACK ↩️                    │
       ├─────────────────────────>        │
       │                                  │
       │         7. CLEANUP (optional)    │
       │         ──────────────────────>  │
       │                                  │
       │   Data consistency maintained ✅  │
```

---

## Key Points

### ✅ What We Guarantee

1. **Atomicity**: Either both databases get the data, or neither does
2. **Consistency**: Both databases always reflect the same logical state
3. **Error Recovery**: Automatic rollback on any failure
4. **Logging**: Clear visibility into transaction states

### ⚠️ Edge Cases Handled

1. **Qdrant Failure After PostgreSQL Flush**:
   - PostgreSQL transaction rolls back
   - No committed data in either database

2. **Partial Qdrant Success**:
   - Compensating transaction deletes any inserted points
   - PostgreSQL rollback ensures consistency

3. **Network Failures**:
   - PostgreSQL transaction timeout triggers rollback
   - Application layer catches and handles exceptions

### 🔍 How to Monitor

Check logs for these markers:

**Success**:
```
✅ Transaction committed successfully - both databases in sync
```

**Failure**:
```
❌ Error during embedding insertion - rolling back PostgreSQL transaction
```

**Cleanup**:
```
Cleaned up Qdrant points after rollback
```

---

## Testing the Transaction Handling

### Test 1: Simulate Qdrant Failure

```python
# Add this to test the rollback mechanism
async def test_qdrant_failure():
    # Temporarily break Qdrant connection
    qdrant_store.client.host = "invalid-host"
    
    try:
        await create_embeddings_for_catalog(db, catalog_id)
    except Exception as e:
        # Verify PostgreSQL was rolled back
        count = await db.execute(
            select(func.count()).select_from(Embedding).where(
                Embedding.catalog_id == catalog_id
            )
        )
        assert count == 0  # Nothing committed to PostgreSQL ✅
```

### Test 2: Verify Both DBs in Sync

```python
async def test_consistency():
    # Insert data
    await create_embeddings_for_catalog(db, catalog_id)
    
    # Check PostgreSQL
    pg_embeddings = await db.execute(
        select(Embedding).where(Embedding.catalog_id == catalog_id)
    )
    pg_count = len(list(pg_embeddings))
    
    # Check Qdrant
    qdrant_result = await qdrant_store.client.count(
        collection_name="embeddings",
        count_filter=Filter(must=[
            FieldCondition(key="catalog_id", match=MatchValue(value=str(catalog_id)))
        ])
    )
    qdrant_count = qdrant_result.count
    
    assert pg_count == qdrant_count  # Both in sync ✅
```

---

## Performance Considerations

### Batching for Efficiency

We batch Qdrant operations to minimize network overhead:

```python
# Instead of N individual calls
for embedding in embeddings:
    await qdrant_store.upsert_embedding(...)  # ❌ Slow

# We do 1 batch call
await qdrant_store.upsert_embeddings_batch(embeddings)  # ✅ Fast
```

### Transaction Duration

- PostgreSQL transaction is open during Qdrant insertion
- Keep Qdrant operations fast (batch API is optimized)
- Typical transaction duration: < 5 seconds for 100 embeddings

---

## Alternative Approaches Considered

### 1. ❌ Commit PostgreSQL First, Then Qdrant
**Problem**: If Qdrant fails, PostgreSQL data is already committed
**Result**: Inconsistent state

### 2. ❌ Two-Phase Commit (2PC) Protocol
**Problem**: Qdrant doesn't support 2PC/XA transactions
**Result**: Not feasible

### 3. ✅ Current Approach: Compensating Transactions (CHOSEN)
**Benefits**: 
- Works with any external system
- Simple to understand and maintain
- Provides eventual consistency with immediate rollback

---

## Future Improvements

1. **Idempotency Tokens**: Add unique tokens to prevent duplicate insertions on retry
2. **Retry Logic**: Automatic retry with exponential backoff for transient failures
3. **Saga Pattern**: For more complex multi-step operations
4. **Monitoring Dashboard**: Real-time visualization of transaction success/failure rates

---

## Conclusion

Our transaction handling ensures **data consistency** between PostgreSQL and Qdrant by:

1. ✅ Using PostgreSQL transactions as the source of truth
2. ✅ Performing Qdrant operations before committing PostgreSQL
3. ✅ Rolling back PostgreSQL if Qdrant fails
4. ✅ Cleaning up Qdrant points if needed (compensating transaction)

This approach guarantees that both databases remain synchronized, even in failure scenarios.

---

**Questions?** Contact the engineering team or check the logs for transaction details.

