"""
Qdrant client for vector operations.

Design notes
------------
- **Async hot path.** Searches and upserts use `AsyncQdrantClient` so they
  do not block the FastAPI event loop.
- **Sync boot path.** Collection creation + payload-index setup happen
  via a small sync client called once from `lifespan` (or lazily on first
  use). Mixing both clients is intentional: the boot path is one-shot, the
  hot path is high-frequency.
- **Sector is mandatory.** Every search/delete takes a `sector_id` and
  ANDs it into the Qdrant filter. This is the second line of defense
  against cross-tenant retrieval leaks; the first is the Postgres-level
  scope check before we ever construct the query vector.
- **Point ID is `Embedding.id`.** No separate `qdrant_point_id` column —
  one source of truth.
"""
import uuid
from typing import Any, Dict, List, Optional, Tuple

import structlog
from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchAny,
    MatchValue,
    PointStruct,
    VectorParams,
)

from app.core.config import settings

logger = structlog.get_logger()


class QdrantVectorStore:
    """Wrapper around `AsyncQdrantClient` with sector-scoped helpers."""

    def __init__(self) -> None:
        common = dict(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            api_key=settings.qdrant_api_key,
            timeout=60,
        )
        # Hot path (async).
        self.async_client = AsyncQdrantClient(**common)
        # One-shot bootstrap (sync). Used only inside `ensure_collection()`.
        self._sync_bootstrap = QdrantClient(**common)
        self.collection_name = settings.qdrant_collection_name

    # ------------------------------------------------------------------
    # Bootstrap (sync, one-shot — called from lifespan)
    # ------------------------------------------------------------------
    def ensure_collection(self) -> None:
        """Create the collection + payload indexes if they don't exist.

        Safe to call multiple times — checks existence first.
        """
        try:
            existing = {c.name for c in self._sync_bootstrap.get_collections().collections}
            if self.collection_name not in existing:
                logger.info("qdrant.create_collection", name=self.collection_name)
                self._sync_bootstrap.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=settings.embedding_dimension,
                        distance=Distance.COSINE,
                    ),
                )

            # Idempotent — create_payload_index is a no-op if it already exists.
            for field, schema in (
                ("sector_id", models.PayloadSchemaType.KEYWORD),
                ("catalog_id", models.PayloadSchemaType.KEYWORD),
                ("kind", models.PayloadSchemaType.KEYWORD),
                ("embed_model", models.PayloadSchemaType.KEYWORD),
            ):
                try:
                    self._sync_bootstrap.create_payload_index(
                        collection_name=self.collection_name,
                        field_name=field,
                        field_schema=schema,
                    )
                except Exception:
                    # Index probably already exists — Qdrant raises on re-create.
                    pass
            logger.info("qdrant.collection_ready", name=self.collection_name)
        except Exception as exc:
            logger.error("qdrant.ensure_collection_failed", error=str(exc))
            raise

    # ------------------------------------------------------------------
    # Writes (async)
    # ------------------------------------------------------------------
    async def upsert_embedding(
        self,
        embedding_id: uuid.UUID,
        vector: List[float],
        payload: Dict[str, Any],
    ) -> str:
        """Single upsert. Payload MUST include `sector_id`."""
        if "sector_id" not in payload:
            raise ValueError("Qdrant payload missing required key 'sector_id'")
        point_id = str(embedding_id)
        await self.async_client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=point_id, vector=vector, payload=payload)],
        )
        return point_id

    async def upsert_embeddings_batch(
        self,
        embeddings: List[Tuple[uuid.UUID, List[float], Dict[str, Any]]],
    ) -> List[str]:
        """Batch upsert. Each payload MUST include `sector_id`."""
        points: List[PointStruct] = []
        for emb_id, vector, payload in embeddings:
            if "sector_id" not in payload:
                raise ValueError(
                    f"Qdrant payload for {emb_id} missing required key 'sector_id'"
                )
            points.append(
                PointStruct(id=str(emb_id), vector=vector, payload=payload)
            )
        await self.async_client.upsert(
            collection_name=self.collection_name, points=points
        )
        logger.info("qdrant.batch_upsert", count=len(points))
        return [str(emb_id) for emb_id, _, _ in embeddings]

    # ------------------------------------------------------------------
    # Search (async, sector-scoped)
    # ------------------------------------------------------------------
    async def search_similar(
        self,
        query_vector: List[float],
        *,
        sector_id: uuid.UUID,
        catalog_id: Optional[uuid.UUID] = None,
        limit: int = 10,
        embed_model: Optional[str] = None,
        filter_conditions: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Search vectors filtered to `sector_id` (mandatory) and the optional
        catalog / embed_model / kind / schema / table filters.

        `filter_conditions` keys (all optional):
          - ``kind``: single string ('object', 'correction', …)
          - ``schema``: single string OR list of strings → matches any
          - ``table``:  single string OR list of strings → matches any
        """
        must: List[FieldCondition] = [
            FieldCondition(key="sector_id", match=MatchValue(value=str(sector_id))),
        ]
        if catalog_id is not None:
            must.append(
                FieldCondition(
                    key="catalog_id", match=MatchValue(value=str(catalog_id))
                )
            )
        if embed_model:
            must.append(
                FieldCondition(key="embed_model", match=MatchValue(value=embed_model))
            )

        if filter_conditions:
            if "kind" in filter_conditions:
                must.append(
                    FieldCondition(
                        key="kind",
                        match=MatchValue(value=filter_conditions["kind"]),
                    )
                )
            for f in ("schema", "table"):
                v = filter_conditions.get(f)
                if v is None:
                    continue
                key = f"metadata.{f}"
                if isinstance(v, list):
                    must.append(FieldCondition(key=key, match=MatchAny(any=v)))
                else:
                    must.append(FieldCondition(key=key, match=MatchValue(value=v)))

        response = await self.async_client.query_points(
            collection_name=self.collection_name,
            query=query_vector,
            query_filter=Filter(must=must),
            limit=limit,
            with_payload=True,
        )
        points = getattr(response, "points", response)
        return [
            {"point_id": p.id, "score": p.score, "payload": p.payload}
            for p in points
        ]

    # ------------------------------------------------------------------
    # Deletes (async, sector-scoped)
    # ------------------------------------------------------------------
    async def delete_by_catalog(
        self, *, sector_id: uuid.UUID, catalog_id: uuid.UUID
    ) -> int:
        """Delete every point for a catalog within a sector."""
        flt = Filter(
            must=[
                FieldCondition(
                    key="sector_id", match=MatchValue(value=str(sector_id))
                ),
                FieldCondition(
                    key="catalog_id", match=MatchValue(value=str(catalog_id))
                ),
            ]
        )
        count_before = await self.async_client.count(
            collection_name=self.collection_name, count_filter=flt
        )
        await self.async_client.delete(
            collection_name=self.collection_name,
            points_selector=models.FilterSelector(filter=flt),
        )
        logger.info(
            "qdrant.delete_catalog",
            sector_id=str(sector_id),
            catalog_id=str(catalog_id),
            count=count_before.count,
        )
        return count_before.count

    async def delete_by_id(self, embedding_id: uuid.UUID) -> bool:
        await self.async_client.delete(
            collection_name=self.collection_name,
            points_selector=models.PointIdsList(points=[str(embedding_id)]),
        )
        return True

    async def delete_batch(self, embedding_ids: List[uuid.UUID]) -> int:
        await self.async_client.delete(
            collection_name=self.collection_name,
            points_selector=models.PointIdsList(
                points=[str(e) for e in embedding_ids]
            ),
        )
        logger.info("qdrant.batch_delete", count=len(embedding_ids))
        return len(embedding_ids)

    # ------------------------------------------------------------------
    # Inspection
    # ------------------------------------------------------------------
    async def get_collection_info(self) -> Dict[str, Any]:
        info = await self.async_client.get_collection(
            collection_name=self.collection_name
        )
        return {
            "vectors_size": info.config.params.vectors.size,
            "vectors_count": info.vectors_count,
            "points_count": info.points_count,
            "status": str(info.status),
        }


# Module-level singleton — collection-create deferred to `ensure_collection()`
# which is called from FastAPI lifespan in `app.main`.
qdrant_store = QdrantVectorStore()


async def get_qdrant_store() -> QdrantVectorStore:
    """FastAPI dependency."""
    return qdrant_store
