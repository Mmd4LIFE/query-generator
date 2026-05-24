"""
Registry of every DB-backed setting key, its default, category, schema,
and a human description for the Settings UI.

Adding a new tunable = add one entry here. The settings_service reads
defaults from this registry, so dq_settings rows are optional — missing
rows fall back to defaults transparently.

Validation is per-key in `validate_value()` so the API rejects bad
values (wrong type, out-of-range numbers, missing required keys in a
dict) before they reach the runtime.
"""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from app.core.model_registry import EMBED_MODELS, GEN_MODELS


# -----------------------------------------------------------------------------
# Default values — copied here so the system runs out of the box with sane
# behavior even if the DB seed somehow didn't happen.
# -----------------------------------------------------------------------------

DEFAULT_SYSTEM_PROMPT_TEMPLATE = """You are an expert {dialect} SQL generator.
You are working with the '{catalog_name}' database catalog.

STRICT GROUNDING RULES (NON-NEGOTIABLE):
1. You MUST ONLY use tables, views, and columns that appear EXPLICITLY in the
   `=== RELEVANT CONTEXT ===` section below. Do not rename them, do not invent
   new ones based on prior knowledge of what a typical schema might look like.
2. For interpreting the MEANING of a column that exists in context, apply
   widely-known SQL/data-modeling conventions (the same heuristics any
   competent analyst would use when reading an unfamiliar schema). Be
   confident: a column whose name clearly implies a meaning has that meaning
   unless the context says otherwise.
3. For ANY catalog-specific semantics — what a column actually represents in
   this particular system, which timestamp to prefer, how enums encode
   business state — defer to the `--- USER CORRECTIONS ---`, `--- EXAMPLES ---`,
   `--- METRICS ---`, and `--- NOTES ---` sections. Those are catalog-scoped
   and override any default convention you might assume.
4. Return `"sql": null` ONLY when a literal table or column you need is
   ABSENT from the context — not when you are merely unsure about a column's
   semantic role. When you do return null, list the specific tables/columns
   that are missing so the operator can add them or write a Note.

PRIORITY OF EVIDENCE (highest first):
  a. `--- USER CORRECTIONS ---` — past human feedback. AUTHORITATIVE.
  b. `--- EXAMPLES ---` — approved query patterns. Adapt them when similar.
  c. `--- METRICS ---` — canonical metric definitions. Reuse verbatim.
  d. `--- DATABASE SCHEMA ---` — source of truth for tables and columns.
  e. `--- NOTES ---` — additional guidelines.

OUTPUT INSTRUCTIONS:
- Always include proper JOINs when referencing multiple tables, using the
  join keys shown in foreign keys or in examples/corrections.
- Return a JSON object with `sql` and `explanation` fields.
- `sql` must contain the complete, executable SQL query (or null if you
  cannot answer with the provided context).
- `explanation` should briefly describe what the query does and, if
  relevant, which example/correction you followed."""

DEFAULT_KIND_BUDGET = {
    "correction": 5,
    "example": 5,
    "metric": 3,
    "note": 3,
    "object": 15,
}


# -----------------------------------------------------------------------------
# Validators
# -----------------------------------------------------------------------------

def _is_int_in_range(lo: int, hi: int) -> Callable[[Any], None]:
    def check(v: Any) -> None:
        if not isinstance(v, int) or isinstance(v, bool):
            raise ValueError(f"must be an integer, got {type(v).__name__}")
        if not (lo <= v <= hi):
            raise ValueError(f"must be between {lo} and {hi}")
    return check


def _is_float_in_range(lo: float, hi: float) -> Callable[[Any], None]:
    def check(v: Any) -> None:
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise ValueError(f"must be a number, got {type(v).__name__}")
        if not (lo <= float(v) <= hi):
            raise ValueError(f"must be between {lo} and {hi}")
    return check


def _is_one_of(choices: List[str]) -> Callable[[Any], None]:
    def check(v: Any) -> None:
        if v not in choices:
            raise ValueError(f"must be one of {choices}")
    return check


def _is_nonempty_str(v: Any) -> None:
    if not isinstance(v, str) or not v.strip():
        raise ValueError("must be a non-empty string")


def _is_kind_budget(v: Any) -> None:
    if not isinstance(v, dict):
        raise ValueError("must be an object")
    required = {"correction", "example", "metric", "note", "object"}
    if set(v.keys()) != required:
        raise ValueError(f"must have exactly these keys: {sorted(required)}")
    for k, n in v.items():
        if not isinstance(n, int) or isinstance(n, bool) or n < 0 or n > 50:
            raise ValueError(f"{k} must be an integer in [0, 50]")


# -----------------------------------------------------------------------------
# Registry
# -----------------------------------------------------------------------------

@dataclass
class SettingSpec:
    key: str
    category: str
    description: str
    default: Any
    validator: Callable[[Any], None] = field(default=lambda v: None)
    # For UI rendering hints — frontend can switch widgets on this.
    ui_type: str = "text"
    choices: Optional[List[Dict[str, Any]]] = None
    # When False, Colonels cannot override this in a Sector. Used for
    # operational dials that must stay uniform across tenants (e.g.
    # OpenAI batch size, cache config). General is the only writer.
    sector_overridable: bool = True


def _gen_model_choices() -> List[Dict[str, Any]]:
    return [
        {"value": m["name"], "label": m["label"], "description": m["description"]}
        for m in GEN_MODELS.values()
    ]


def _embed_model_choices() -> List[Dict[str, Any]]:
    return [
        {"value": m["name"], "label": m["label"]}
        for m in EMBED_MODELS.values()
    ]


SETTINGS: Dict[str, SettingSpec] = {spec.key: spec for spec in [
    SettingSpec(
        key="generation.gen_model",
        category="generation",
        description="OpenAI chat model used to generate SQL.",
        default="gpt-4o",
        validator=_is_one_of(list(GEN_MODELS.keys())),
        ui_type="select",
        choices=_gen_model_choices(),
    ),
    SettingSpec(
        key="generation.max_tokens",
        category="generation",
        description="Hard cap on tokens the model can emit per request.",
        default=2000,
        validator=_is_int_in_range(100, 16000),
        ui_type="int",
    ),
    SettingSpec(
        key="generation.temperature",
        category="generation",
        description="Sampling temperature. 0 = deterministic, 1 = creative.",
        default=0.1,
        validator=_is_float_in_range(0.0, 2.0),
        ui_type="float",
    ),
    SettingSpec(
        key="retrieval.max_chunks",
        category="retrieval",
        description="Overall cap on chunks merged from per-kind retrieval.",
        default=25,
        validator=_is_int_in_range(1, 100),
        ui_type="int",
    ),
    SettingSpec(
        key="retrieval.kind_budget",
        category="retrieval",
        description="Per-kind retrieval budget. Higher values for example/correction "
                    "make the generator follow human corrections more aggressively.",
        default=DEFAULT_KIND_BUDGET,
        validator=_is_kind_budget,
        ui_type="kind_budget",
    ),
    SettingSpec(
        key="retrieval.context_max_tokens",
        category="retrieval",
        description="Token budget for the assembled context string sent to the LLM.",
        default=6000,
        validator=_is_int_in_range(500, 100_000),
        ui_type="int",
    ),
    SettingSpec(
        key="retrieval.mmr_lambda",
        category="retrieval",
        description="MMR re-rank tradeoff for schema (object) chunks. "
                    "1.0 = pure relevance (default behavior). "
                    "Lower values diversify away from near-duplicate schema chunks. "
                    "Typical sweet spot: 0.6–0.75. Set to 1.0 to disable.",
        default=1.0,
        validator=_is_float_in_range(0.0, 1.0),
        ui_type="float",
    ),
    SettingSpec(
        key="embeddings.batch_size",
        category="embeddings",
        description="How many texts to send per OpenAI embedding API call.",
        default=64,
        validator=_is_int_in_range(1, 2048),
        ui_type="int",
        # Operational dial — must be uniform across tenants.
        sector_overridable=False,
    ),
    SettingSpec(
        key="prompt.system_template",
        category="prompt",
        description="System prompt template. Use {dialect} and {catalog_name} placeholders. "
                    "Policy section and response-format JSON guidance are appended automatically.",
        default=DEFAULT_SYSTEM_PROMPT_TEMPLATE,
        validator=_is_nonempty_str,
        ui_type="textarea",
    ),
    # Reference-only for now — see Phase 2 for the switch-and-reindex flow.
    SettingSpec(
        key="embeddings.embed_model",
        category="embeddings",
        description="OpenAI embedding model. Changing requires re-embedding every "
                    "catalog (Phase 2 will wire this automatically).",
        default="text-embedding-3-large",
        validator=_is_one_of(list(EMBED_MODELS.keys())),
        ui_type="select",
        choices=_embed_model_choices(),
    ),
]}


def get_spec(key: str) -> Optional[SettingSpec]:
    return SETTINGS.get(key)


def all_specs() -> List[SettingSpec]:
    return list(SETTINGS.values())


def validate_value(key: str, value: Any) -> None:
    spec = SETTINGS.get(key)
    if not spec:
        raise ValueError(f"Unknown setting key: {key}")
    spec.validator(value)
