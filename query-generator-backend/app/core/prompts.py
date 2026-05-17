"""
Prompt building for SQL generation
"""
from typing import Any, Dict, List, Optional

from app.schemas.generate import GenerationConstraints, GenerationIncludes


def build_system_prompt(
    dialect: str,
    policy: Dict[str, Any],
    catalog_name: str
) -> str:
    """
    Build system prompt for SQL generation.
    
    Args:
        dialect: SQL dialect (postgres, mysql, etc.)
        policy: Policy configuration
        catalog_name: Name of the catalog
        
    Returns:
        System prompt string
    """
    prompt_parts = [
        f"You are an expert {dialect.upper()} SQL generator.",
        f"You are working with the '{catalog_name}' database catalog.",
        "",
        "STRICT GROUNDING RULES (NON-NEGOTIABLE):",
        "1. You MUST ONLY use tables, views, and columns that appear EXPLICITLY in the",
        "   `=== RELEVANT CONTEXT ===` section below. Do not rename them, do not invent",
        "   new ones based on prior knowledge of what a typical schema might look like.",
        "2. For interpreting the MEANING of a column that exists in context, apply",
        "   widely-known SQL/data-modeling conventions (the same heuristics any",
        "   competent analyst would use when reading an unfamiliar schema). Be",
        "   confident: a column whose name clearly implies a meaning has that meaning",
        "   unless the context says otherwise.",
        "3. For ANY catalog-specific semantics — what a column actually represents in",
        "   this particular system, which timestamp to prefer, how enums encode",
        "   business state — defer to the `--- USER CORRECTIONS ---`, `--- EXAMPLES ---`,",
        "   `--- METRICS ---`, and `--- NOTES ---` sections. Those are catalog-scoped",
        "   and override any default convention you might assume.",
        "4. Return `\"sql\": null` ONLY when a literal table or column you need is",
        "   ABSENT from the context — not when you are merely unsure about a column's",
        "   semantic role. When you do return null, list the specific tables/columns",
        "   that are missing so the operator can add them or write a Note.",
        "",
        "PRIORITY OF EVIDENCE (highest first):",
        "  a. `--- USER CORRECTIONS ---` — past human feedback. These are AUTHORITATIVE.",
        "     If a correction tells you which table/column to use, follow it.",
        "  b. `--- EXAMPLES ---` — approved query patterns. Adapt them whenever the",
        "     question is similar; do not deviate from their joins/filters without reason.",
        "  c. `--- METRICS ---` — canonical metric definitions. Reuse the expression",
        "     verbatim when the user asks for that metric.",
        "  d. `--- DATABASE SCHEMA ---` — the source of truth for tables and columns.",
        "  e. `--- NOTES ---` — additional guidelines.",
        "",
        "OUTPUT INSTRUCTIONS:",
        "4. Always include proper JOINs when referencing multiple tables, using the",
        "   join keys shown in foreign keys or in examples/corrections.",
        "5. Return your response as a JSON object with `sql` and `explanation` fields.",
        "6. The `sql` field must contain the complete, executable SQL query (or null",
        "   if you cannot answer with the provided context).",
        "7. The `explanation` field should briefly describe what the query does and,",
        "   if relevant, which example/correction you followed.",
        "",
        "POLICIES AND CONSTRAINTS:"
    ]
    
    # Add policy information
    if not policy.get("allow_write", False):
        prompt_parts.append("- ONLY SELECT queries are allowed (no INSERT, UPDATE, DELETE, etc.)")
    
    default_limit = policy.get("default_limit")
    if default_limit:
        prompt_parts.append(f"- If no LIMIT is specified, a LIMIT of {default_limit} will be automatically added")
    
    banned_tables = policy.get("banned_tables", [])
    if banned_tables:
        prompt_parts.append(f"- NEVER use these banned tables: {', '.join(banned_tables)}")
    
    banned_columns = policy.get("banned_columns", [])
    if banned_columns:
        prompt_parts.append(f"- NEVER use these banned columns: {', '.join(banned_columns)}")
    
    banned_schemas = policy.get("banned_schemas", [])
    if banned_schemas:
        prompt_parts.append(f"- NEVER use these banned schemas: {', '.join(banned_schemas)}")
    
    max_rows = policy.get("max_rows_returned")
    if max_rows:
        prompt_parts.append(f"- Maximum LIMIT allowed is {max_rows}")
    
    allowed_functions = policy.get("allowed_functions")
    if allowed_functions:
        prompt_parts.append(f"- Only these functions are allowed: {', '.join(allowed_functions)}")
    
    blocked_functions = policy.get("blocked_functions")
    if blocked_functions:
        prompt_parts.append(f"- These functions are blocked: {', '.join(blocked_functions)}")
    
    prompt_parts.extend([
        "",
        "RESPONSE FORMAT:",
        "Always respond with valid JSON in this exact format:",
        '{',
        '  "sql": "SELECT * FROM schema.table LIMIT 100;",',
        '  "explanation": "Brief description of the query and which context guided it."',
        '}',
        "",
        "If the context lacks a required table or column, respond with:",
        '{',
        '  "sql": null,',
        '  "explanation": "Missing from catalog: <list the specific tables/columns needed>."',
        '}',
        "",
        "Do not include any text before or after the JSON response."
    ])
    
    return "\n".join(prompt_parts)


def build_user_prompt(
    question: str,
    context: str,
    constraints: Optional[GenerationConstraints] = None,
    includes: Optional[GenerationIncludes] = None
) -> str:
    """
    Build user prompt with context and question.
    
    Args:
        question: Natural language question
        context: Retrieved context from RAG
        constraints: Generation constraints
        includes: Include preferences
        
    Returns:
        User prompt string
    """
    prompt_parts = []
    
    # Add context
    if context:
        prompt_parts.append(context)
        prompt_parts.append("")
    
    # Add includes if specified
    if includes:
        include_parts = []
        if includes.schemas:
            include_parts.append(f"Focus on schemas: {', '.join(includes.schemas)}")
        if includes.tables:
            include_parts.append(f"Focus on tables: {', '.join(includes.tables)}")
        if includes.columns:
            include_parts.append(f"Focus on columns: {', '.join(includes.columns)}")
        
        if include_parts:
            prompt_parts.append("FOCUS AREAS:")
            prompt_parts.extend([f"- {part}" for part in include_parts])
            prompt_parts.append("")
    
    # Add constraints if specified
    if constraints:
        constraint_parts = []
        
        if constraints.must_include_metrics:
            constraint_parts.append(f"Must include these metrics: {', '.join(constraints.must_include_metrics)}")
        
        if constraints.time_range:
            constraint_parts.append(f"Time range: {constraints.time_range}")
        
        if constraints.max_rows:
            constraint_parts.append(f"Maximum rows to return: {constraints.max_rows}")
        
        if constraints.include_totals:
            constraint_parts.append("Include total/aggregate calculations")
        
        if constraints.group_by_period:
            constraint_parts.append(f"Group results by: {constraints.group_by_period}")
        
        if constraint_parts:
            prompt_parts.append("ADDITIONAL CONSTRAINTS:")
            prompt_parts.extend([f"- {part}" for part in constraint_parts])
            prompt_parts.append("")
    
    # Add the question
    prompt_parts.append("QUESTION:")
    prompt_parts.append(question)
    prompt_parts.append("")
    prompt_parts.append("Generate the SQL query to answer this question:")
    
    return "\n".join(prompt_parts)


def build_example_context() -> str:
    """
    Build example context for demonstration.
    
    Returns:
        Example context string
    """
    return """=== RELEVANT CONTEXT ===

--- DATABASE SCHEMA ---
Table: public.users
Catalog: ecommerce_prod
Description: User accounts and profile information
Primary Key: id
Columns:
  - id (bigint) NOT NULL -- Primary key
  - email (varchar) NOT NULL -- User email address
  - username (varchar) NOT NULL -- Unique username
  - created_at (timestamptz) NOT NULL -- Account creation timestamp
  - is_active (boolean) NOT NULL -- Account status

Table: public.orders
Catalog: ecommerce_prod
Description: Customer orders
Primary Key: id
Foreign Keys: user_id
Columns:
  - id (bigint) NOT NULL -- Primary key
  - user_id (bigint) NOT NULL -- FK to users.id
  - total_amount (numeric) NOT NULL -- Order total in cents
  - status (varchar) NOT NULL -- Order status
  - created_at (timestamptz) NOT NULL -- Order timestamp

--- METRICS ---
Metric: GMV
Description: Gross Merchandise Value - total value of orders
Expression: SUM(total_amount) / 100.0
Tags: revenue, kpi

--- EXAMPLES ---
Example: Top users by order count
Description: Find users with the most orders in the last 30 days
Engine: postgres
SQL: SELECT u.username, COUNT(o.id) as order_count 
     FROM users u 
     JOIN orders o ON u.id = o.user_id 
     WHERE o.created_at >= NOW() - INTERVAL '30 days'
     GROUP BY u.id, u.username 
     ORDER BY order_count DESC 
     LIMIT 10;

=== END CONTEXT ==="""


def estimate_prompt_tokens(text: str) -> int:
    """
    Estimate the number of tokens in a text string.
    
    Args:
        text: Text to estimate
        
    Returns:
        Estimated token count
    """
    # Rough approximation: 1 token ≈ 4 characters
    return len(text) // 4


def truncate_context(context: str, max_tokens: int = 6000) -> str:
    """
    Truncate context to fit within token limit.
    
    Args:
        context: Context string to truncate
        max_tokens: Maximum number of tokens allowed
        
    Returns:
        Truncated context string
    """
    estimated_tokens = estimate_prompt_tokens(context)
    
    if estimated_tokens <= max_tokens:
        return context
    
    # Calculate target length
    target_length = int(len(context) * (max_tokens / estimated_tokens))
    
    # Truncate at word boundary
    if target_length < len(context):
        truncated = context[:target_length]
        last_space = truncated.rfind(' ')
        if last_space > 0:
            truncated = truncated[:last_space]
        
        truncated += "\n\n[Context truncated to fit token limit]"
        return truncated
    
    return context 