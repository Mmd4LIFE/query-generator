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


async def generate_embeddings(
    texts: List[str],
    *,
    model: Optional[str] = None,
) -> List[List[float]]:
    """
    Embed a list of texts.

    The caller is expected to pass `model` explicitly when it matters
    (writer paths in `app.core.embeddings` resolve the active model once
    and stamp every row with it). When omitted we read the live
    `embeddings.embed_model` setting, falling back to env.
    """
    if not texts:
        return []

    if model is None:
        try:
            from app.core.settings_service import get_value_standalone
            v = await get_value_standalone("embeddings.embed_model", sector_id=None)
            model = v if isinstance(v, str) and v.strip() else settings.embed_model
        except Exception:
            model = settings.embed_model

    try:
        logger.info("openai.embeddings.start", count=len(texts), model=model)

        # Batch size is admin-tunable via settings; env stays as the floor.
        from app.core.settings_service import get_value_standalone
        try:
            batch_size = await get_value_standalone(
                "embeddings.batch_size", sector_id=None
            )
            if not isinstance(batch_size, int) or batch_size < 1:
                batch_size = settings.batch_size
        except Exception:
            batch_size = settings.batch_size

        embeddings: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            response = await client.embeddings.create(
                model=model,
                input=batch,
                encoding_format="float",
            )
            embeddings.extend(d.embedding for d in response.data)
            if i + batch_size < len(texts):
                await asyncio.sleep(0.1)

        logger.info("openai.embeddings.done", count=len(embeddings), model=model)
        return embeddings

    except Exception as e:
        logger.error("openai.embeddings.failed", error=str(e), model=model)
        raise


async def generate_sql(
    prompt: str,
    system_prompt: str,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
) -> Tuple[str, Dict]:
    """
    Generate SQL using OpenAI's chat completion API.

    Model, max_tokens, and temperature come from the live settings table
    so admins can tune them without a redeploy. Explicit arguments still
    win when provided (used for tests / future per-request overrides).

    Returns:
        Tuple of (generated_text, usage_info). `usage_info` carries the
        model name so callers can compute cost from `model_registry`.
    """
    from app.core.settings_service import get_value_standalone

    # Resolve live settings, with env values as the safety net.
    try:
        model = await get_value_standalone("generation.gen_model")
        if not isinstance(model, str) or not model.strip():
            model = settings.gen_model
    except Exception:
        model = settings.gen_model

    if max_tokens is None:
        try:
            v = await get_value_standalone("generation.max_tokens")
            max_tokens = int(v) if isinstance(v, int) else settings.max_tokens
        except Exception:
            max_tokens = settings.max_tokens

    if temperature is None:
        try:
            v = await get_value_standalone("generation.temperature")
            temperature = float(v) if isinstance(v, (int, float)) else settings.temperature
        except Exception:
            temperature = settings.temperature

    try:
        logger.info("Generating SQL", model=model, temperature=temperature, max_tokens=max_tokens)

        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        usage = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
            "model": model,
        }

        logger.info(
            "SQL generated successfully",
            usage=usage,
            finish_reason=response.choices[0].finish_reason,
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