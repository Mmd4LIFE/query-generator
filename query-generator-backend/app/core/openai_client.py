"""
OpenAI client for embeddings and text generation
"""
import asyncio
from typing import Dict, List, Optional, Tuple

import openai
import structlog
from openai import AsyncOpenAI

from app.core.config import settings

logger = structlog.get_logger()

# Initialize OpenAI client
client = AsyncOpenAI(api_key=settings.openai_api_key)


async def generate_embeddings(texts: List[str]) -> List[List[float]]:
    """
    Generate embeddings for a list of texts using OpenAI's embedding model.
    
    Args:
        texts: List of text strings to embed
        
    Returns:
        List of embedding vectors
    """
    if not texts:
        return []
    
    try:
        logger.info("Generating embeddings", count=len(texts), model=settings.embed_model)
        
        # Process in batches to avoid rate limits
        batch_size = settings.batch_size
        embeddings = []
        
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            
            response = await client.embeddings.create(
                model=settings.embed_model,
                input=batch,
                encoding_format="float"
            )
            
            batch_embeddings = [data.embedding for data in response.data]
            embeddings.extend(batch_embeddings)
            
            # Small delay to avoid rate limiting
            if i + batch_size < len(texts):
                await asyncio.sleep(0.1)
        
        logger.info("Embeddings generated successfully", count=len(embeddings))
        return embeddings
        
    except Exception as e:
        logger.error("Failed to generate embeddings", error=str(e))
        raise


async def generate_sql(
    prompt: str,
    system_prompt: str,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None
) -> Tuple[str, Dict]:
    """
    Generate SQL using OpenAI's chat completion API.
    
    Args:
        prompt: User prompt with context and question
        system_prompt: System prompt with instructions and policies
        max_tokens: Maximum tokens to generate
        temperature: Sampling temperature
        
    Returns:
        Tuple of (generated_text, usage_info)
    """
    try:
        logger.info("Generating SQL", model=settings.gen_model)
        
        response = await client.chat.completions.create(
            model=settings.gen_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            max_tokens=max_tokens or settings.max_tokens,
            temperature=temperature or settings.temperature,
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        usage = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens
        }
        
        logger.info(
            "SQL generated successfully",
            usage=usage,
            finish_reason=response.choices[0].finish_reason
        )
        
        return content, usage
        
    except Exception as e:
        logger.error("Failed to generate SQL", error=str(e))
        raise


async def embed_single_text(text: str) -> List[float]:
    """
    Generate embedding for a single text.
    
    Args:
        text: Text to embed
        
    Returns:
        Embedding vector
    """
    embeddings = await generate_embeddings([text])
    return embeddings[0] if embeddings else []


async def test_openai_connection() -> bool:
    """
    Test OpenAI API connection.
    
    Returns:
        True if connection is successful
    """
    try:
        await embed_single_text("test")
        return True
    except Exception as e:
        logger.error("OpenAI connection test failed", error=str(e))
        return False 