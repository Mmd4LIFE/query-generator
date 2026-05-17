"""
Curated registry of supported OpenAI models.

Pricing is per-token (USD). Sourced from OpenAI's public pricing as of
2026-05. Update here when prices change — this is the only place the
generator looks up cost.
"""
from typing import Dict, List, Optional, TypedDict


class GenModelInfo(TypedDict):
    name: str
    label: str
    input_per_token: float
    output_per_token: float
    context_window: int
    description: str


class EmbedModelInfo(TypedDict):
    name: str
    label: str
    per_token: float
    dimension: int


# Generation models the admin can pick from in the Settings page.
GEN_MODELS: Dict[str, GenModelInfo] = {
    "gpt-4o": {
        "name": "gpt-4o",
        "label": "GPT-4o",
        "input_per_token": 2.50 / 1_000_000,
        "output_per_token": 10.00 / 1_000_000,
        "context_window": 128_000,
        "description": "Balanced quality and cost. Default.",
    },
    "gpt-4o-mini": {
        "name": "gpt-4o-mini",
        "label": "GPT-4o mini",
        "input_per_token": 0.15 / 1_000_000,
        "output_per_token": 0.60 / 1_000_000,
        "context_window": 128_000,
        "description": "Cheapest. Good for simple queries; weaker reasoning.",
    },
    "gpt-4-turbo": {
        "name": "gpt-4-turbo",
        "label": "GPT-4 Turbo",
        "input_per_token": 10.00 / 1_000_000,
        "output_per_token": 30.00 / 1_000_000,
        "context_window": 128_000,
        "description": "Strong but expensive; gpt-4o is usually a better default.",
    },
    "gpt-4.1": {
        "name": "gpt-4.1",
        "label": "GPT-4.1",
        "input_per_token": 2.00 / 1_000_000,
        "output_per_token": 8.00 / 1_000_000,
        "context_window": 1_000_000,
        "description": "Long context. Use if your catalog is huge.",
    },
}

# Embedding models. Listed so the Settings page can show them, but
# changing this requires recreating the Qdrant collection (different
# dimension) — Phase 2 will wire the switch+reindex flow. For now this
# is reference data only.
EMBED_MODELS: Dict[str, EmbedModelInfo] = {
    "text-embedding-3-large": {
        "name": "text-embedding-3-large",
        "label": "text-embedding-3-large (3072 dims)",
        "per_token": 0.13 / 1_000_000,
        "dimension": 3072,
    },
    "text-embedding-3-small": {
        "name": "text-embedding-3-small",
        "label": "text-embedding-3-small (1536 dims)",
        "per_token": 0.02 / 1_000_000,
        "dimension": 1536,
    },
}


def list_gen_models() -> List[GenModelInfo]:
    return list(GEN_MODELS.values())


def list_embed_models() -> List[EmbedModelInfo]:
    return list(EMBED_MODELS.values())


def calculate_cost(
    model: Optional[str],
    prompt_tokens: Optional[int],
    completion_tokens: Optional[int],
) -> Optional[float]:
    """Compute the USD cost of one chat-completion call.

    Returns None if the model is unknown or token counts are missing —
    callers should treat None as "unmeasurable", not as zero.
    """
    if not model or prompt_tokens is None or completion_tokens is None:
        return None
    info = GEN_MODELS.get(model)
    if not info:
        return None
    return (
        prompt_tokens * info["input_per_token"]
        + completion_tokens * info["output_per_token"]
    )
