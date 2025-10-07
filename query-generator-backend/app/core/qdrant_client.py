"""
Qdrant client for vector operations
"""
import uuid
from typing import Any, Dict, List, Optional, Tuple

import structlog
from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

from app.core.config import settings

logger = structlog.get_logger()


class QdrantVectorStore:
    """Wrapper for Qdrant client operations"""
    
    def __init__(self):
        """Initialize Qdrant client"""
        self.client = QdrantClient(
            host=settings.qdrant_host,
            port=settings.qdrant_port,
            api_key=settings.qdrant_api_key,
            timeout=60
        )
        self.collection_name = settings.qdrant_collection_name
        self._ensure_collection()
    
    def _ensure_collection(self):
        """Ensure the collection exists with proper configuration"""
        try:
            collections = self.client.get_collections().collections
            collection_names = [col.name for col in collections]
            
            if self.collection_name not in collection_names:
                logger.info("Creating Qdrant collection", collection=self.collection_name)
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=settings.embedding_dimension,
                        distance=Distance.COSINE
                    )
                )
                
                # Create indexes for filtering
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="catalog_id",
                    field_schema=models.PayloadSchemaType.KEYWORD
                )
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="kind",
                    field_schema=models.PayloadSchemaType.KEYWORD
                )
                self.client.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="embedding_id",
                    field_schema=models.PayloadSchemaType.KEYWORD
                )
                
                logger.info("Qdrant collection created successfully", collection=self.collection_name)
            else:
                logger.info("Qdrant collection already exists", collection=self.collection_name)
                
        except Exception as e:
            logger.error("Failed to ensure Qdrant collection", error=str(e))
            raise
    
    async def upsert_embedding(
        self,
        embedding_id: uuid.UUID,
        vector: List[float],
        payload: Dict[str, Any]
    ) -> str:
        """
        Insert or update an embedding in Qdrant.
        
        Args:
            embedding_id: Unique ID for this embedding (from PostgreSQL)
            vector: The embedding vector
            payload: Metadata to store with the vector
            
        Returns:
            Point ID in Qdrant (same as embedding_id as string)
        """
        try:
            point_id = str(embedding_id)
            
            # Add embedding_id to payload for reference
            payload["embedding_id"] = point_id
            
            point = PointStruct(
                id=point_id,
                vector=vector,
                payload=payload
            )
            
            self.client.upsert(
                collection_name=self.collection_name,
                points=[point]
            )
            
            logger.debug("Upserted embedding to Qdrant", point_id=point_id)
            return point_id
            
        except Exception as e:
            logger.error("Failed to upsert embedding to Qdrant", error=str(e), embedding_id=embedding_id)
            raise
    
    async def upsert_embeddings_batch(
        self,
        embeddings: List[Tuple[uuid.UUID, List[float], Dict[str, Any]]]
    ) -> List[str]:
        """
        Batch insert or update embeddings in Qdrant.
        
        Args:
            embeddings: List of (embedding_id, vector, payload) tuples
            
        Returns:
            List of point IDs
        """
        try:
            points = []
            for embedding_id, vector, payload in embeddings:
                point_id = str(embedding_id)
                payload["embedding_id"] = point_id
                
                points.append(PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=payload
                ))
            
            self.client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            
            logger.info("Batch upserted embeddings to Qdrant", count=len(points))
            return [str(emb[0]) for emb in embeddings]
            
        except Exception as e:
            logger.error("Failed to batch upsert embeddings to Qdrant", error=str(e))
            raise
    
    async def search_similar(
        self,
        query_vector: List[float],
        catalog_id: uuid.UUID,
        limit: int = 10,
        filter_conditions: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Search for similar vectors in Qdrant.
        
        Args:
            query_vector: The query embedding vector
            catalog_id: Catalog ID to filter by
            limit: Maximum number of results
            filter_conditions: Additional filter conditions
            
        Returns:
            List of search results with scores and payloads
        """
        try:
            # Build filter
            must_conditions = [
                FieldCondition(
                    key="catalog_id",
                    match=MatchValue(value=str(catalog_id))
                )
            ]
            
            # Add additional filters if provided
            if filter_conditions:
                if "kind" in filter_conditions:
                    must_conditions.append(
                        FieldCondition(
                            key="kind",
                            match=MatchValue(value=filter_conditions["kind"])
                        )
                    )
                if "schema" in filter_conditions:
                    must_conditions.append(
                        FieldCondition(
                            key="metadata.schema",
                            match=MatchValue(value=filter_conditions["schema"])
                        )
                    )
                if "table" in filter_conditions:
                    must_conditions.append(
                        FieldCondition(
                            key="metadata.table",
                            match=MatchValue(value=filter_conditions["table"])
                        )
                    )
            
            search_filter = Filter(must=must_conditions)
            
            # Perform search
            results = self.client.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                query_filter=search_filter,
                limit=limit
            )
            
            # Format results
            formatted_results = []
            for result in results:
                formatted_results.append({
                    "point_id": result.id,
                    "score": result.score,
                    "payload": result.payload
                })
            
            logger.info(
                "Qdrant search completed",
                catalog_id=catalog_id,
                results_count=len(formatted_results)
            )
            
            return formatted_results
            
        except Exception as e:
            logger.error("Failed to search in Qdrant", error=str(e))
            raise
    
    async def delete_by_catalog(self, catalog_id: uuid.UUID) -> int:
        """
        Delete all embeddings for a catalog.
        
        Args:
            catalog_id: Catalog ID to delete embeddings for
            
        Returns:
            Number of points deleted
        """
        try:
            # Get count before deletion
            count_before = self.client.count(
                collection_name=self.collection_name,
                count_filter=Filter(
                    must=[
                        FieldCondition(
                            key="catalog_id",
                            match=MatchValue(value=str(catalog_id))
                        )
                    ]
                )
            )
            
            # Delete points
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=models.FilterSelector(
                    filter=Filter(
                        must=[
                            FieldCondition(
                                key="catalog_id",
                                match=MatchValue(value=str(catalog_id))
                            )
                        ]
                    )
                )
            )
            
            logger.info("Deleted embeddings from Qdrant", catalog_id=catalog_id, count=count_before.count)
            return count_before.count
            
        except Exception as e:
            logger.error("Failed to delete embeddings from Qdrant", error=str(e))
            raise
    
    async def delete_by_id(self, embedding_id: uuid.UUID) -> bool:
        """
        Delete a specific embedding by ID.
        
        Args:
            embedding_id: Embedding ID to delete
            
        Returns:
            True if deleted successfully
        """
        try:
            point_id = str(embedding_id)
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=models.PointIdsList(
                    points=[point_id]
                )
            )
            
            logger.debug("Deleted embedding from Qdrant", embedding_id=embedding_id)
            return True
            
        except Exception as e:
            logger.error("Failed to delete embedding from Qdrant", error=str(e), embedding_id=embedding_id)
            raise
    
    async def delete_batch(self, embedding_ids: List[uuid.UUID]) -> int:
        """
        Delete multiple embeddings by ID.
        
        Args:
            embedding_ids: List of embedding IDs to delete
            
        Returns:
            Number of embeddings deleted
        """
        try:
            point_ids = [str(emb_id) for emb_id in embedding_ids]
            
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=models.PointIdsList(
                    points=point_ids
                )
            )
            
            logger.info("Batch deleted embeddings from Qdrant", count=len(point_ids))
            return len(point_ids)
            
        except Exception as e:
            logger.error("Failed to batch delete embeddings from Qdrant", error=str(e))
            raise
    
    def get_collection_info(self) -> Dict[str, Any]:
        """Get information about the collection"""
        try:
            collection_info = self.client.get_collection(collection_name=self.collection_name)
            return {
                "name": collection_info.config.params.vectors.size,
                "vectors_count": collection_info.vectors_count,
                "points_count": collection_info.points_count,
                "status": collection_info.status
            }
        except Exception as e:
            logger.error("Failed to get collection info", error=str(e))
            raise


# Global instance
qdrant_store = QdrantVectorStore()


async def get_qdrant_store() -> QdrantVectorStore:
    """Dependency to get Qdrant store instance"""
    return qdrant_store

