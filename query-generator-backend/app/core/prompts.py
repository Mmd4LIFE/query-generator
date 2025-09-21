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
        "IMPORTANT INSTRUCTIONS:",
        "1. Generate ONLY valid SQL queries based on the provided context",
        "2. Use table and column names EXACTLY as shown in the context",
        "3. Always include proper JOINs when referencing multiple tables",
        "4. Return your response as a JSON object with 'sql' and 'explanation' fields",
        "5. The 'sql' field should contain the complete, executable SQL query",
        "6. The 'explanation' field should briefly describe what the query does",
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
        '  "sql": "SELECT * FROM table_name LIMIT 100;",',
        '  "explanation": "This query retrieves all records from table_name with a limit of 100 rows."',
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