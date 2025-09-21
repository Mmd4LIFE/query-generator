"""
SQL guardrails and validation
"""
import re
from typing import Any, Dict, List, Optional, Tuple

import sqlglot
import structlog
from sqlglot import exp

logger = structlog.get_logger()


class GuardrailsResult:
    """Result of applying guardrails to SQL"""
    
    def __init__(self):
        self.sql: Optional[str] = None
        self.syntax_valid: bool = False
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.violations: List[str] = []
        self.modifications: List[str] = []
        self.parsed_tables: List[str] = []
        self.parsed_columns: List[str] = []


def parse_sql(sql: str, dialect: str = "postgres") -> Tuple[Optional[exp.Expression], List[str]]:
    """
    Parse SQL using sqlglot.
    
    Args:
        sql: SQL query string
        dialect: SQL dialect
        
    Returns:
        Tuple of (parsed_expression, errors)
    """
    try:
        parsed = sqlglot.parse_one(sql, dialect=dialect)
        return parsed, []
    except Exception as e:
        return None, [str(e)]


def extract_tables_and_columns(parsed_sql: exp.Expression) -> Tuple[List[str], List[str]]:
    """
    Extract table and column names from parsed SQL.
    
    Args:
        parsed_sql: Parsed SQL expression
        
    Returns:
        Tuple of (tables, columns)
    """
    tables = []
    columns = []
    
    # Extract tables
    for table in parsed_sql.find_all(exp.Table):
        table_name = table.name
        if table.db:
            table_name = f"{table.db}.{table_name}"
        tables.append(table_name)
    
    # Extract columns
    for column in parsed_sql.find_all(exp.Column):
        if column.name:
            columns.append(column.name)
    
    return list(set(tables)), list(set(columns))


def check_read_only(parsed_sql: exp.Expression) -> bool:
    """
    Check if SQL is read-only (SELECT only).
    
    Args:
        parsed_sql: Parsed SQL expression
        
    Returns:
        True if read-only, False otherwise
    """
    # Check for write operations
    write_operations = [
        exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create,
        exp.Alter, exp.Merge
    ]
    
    for write_op in write_operations:
        if parsed_sql.find(write_op):
            return False
    
    return True


def inject_limit(sql: str, limit: int, dialect: str = "postgres") -> Tuple[str, bool]:
    """
    Inject LIMIT clause if not present.
    
    Args:
        sql: SQL query string
        limit: Limit value to inject
        dialect: SQL dialect
        
    Returns:
        Tuple of (modified_sql, was_modified)
    """
    try:
        parsed = sqlglot.parse_one(sql, dialect=dialect)
        
        # Check if LIMIT already exists
        if parsed.find(exp.Limit):
            return sql, False
        
        # Only add LIMIT to SELECT statements
        if not isinstance(parsed, exp.Select):
            return sql, False
        
        # Add LIMIT
        parsed = parsed.limit(limit)
        modified_sql = parsed.sql(dialect=dialect)
        
        return modified_sql, True
        
    except Exception as e:
        logger.warning("Failed to inject LIMIT", error=str(e))
        return sql, False


def check_banned_items(
    tables: List[str],
    columns: List[str],
    banned_tables: List[str],
    banned_columns: List[str],
    banned_schemas: List[str]
) -> List[str]:
    """
    Check for banned tables, columns, or schemas.
    
    Args:
        tables: List of table names in query
        columns: List of column names in query
        banned_tables: List of banned table names
        banned_columns: List of banned column names
        banned_schemas: List of banned schema names
        
    Returns:
        List of violations
    """
    violations = []
    
    # Check banned tables
    for table in tables:
        table_parts = table.split('.')
        table_name = table_parts[-1]
        schema_name = table_parts[0] if len(table_parts) > 1 else None
        
        if table_name.lower() in [t.lower() for t in banned_tables]:
            violations.append(f"Banned table: {table}")
        
        if schema_name and schema_name.lower() in [s.lower() for s in banned_schemas]:
            violations.append(f"Banned schema: {schema_name}")
    
    # Check banned columns
    for column in columns:
        if column.lower() in [c.lower() for c in banned_columns]:
            violations.append(f"Banned column: {column}")
    
    return violations


def apply_pii_masking(sql: str, pii_columns: List[str], dialect: str = "postgres") -> Tuple[str, List[str]]:
    """
    Apply PII masking to SQL query.
    
    Args:
        sql: SQL query string
        pii_columns: List of PII column names
        dialect: SQL dialect
        
    Returns:
        Tuple of (modified_sql, modifications)
    """
    if not pii_columns:
        return sql, []
    
    modifications = []
    
    try:
        parsed = sqlglot.parse_one(sql, dialect=dialect)
        
        # Find and replace PII columns with hashed versions
        for column in parsed.find_all(exp.Column):
            if column.name and column.name.lower() in [c.lower() for c in pii_columns]:
                # Replace with SHA256 hash
                hash_func = exp.func("SHA256", column)
                column.replace(hash_func)
                modifications.append(f"Masked PII column: {column.name}")
        
        modified_sql = parsed.sql(dialect=dialect)
        return modified_sql, modifications
        
    except Exception as e:
        logger.warning("Failed to apply PII masking", error=str(e))
        return sql, []


def validate_functions(
    parsed_sql: exp.Expression,
    allowed_functions: Optional[List[str]] = None,
    blocked_functions: Optional[List[str]] = None
) -> List[str]:
    """
    Validate function usage in SQL.
    
    Args:
        parsed_sql: Parsed SQL expression
        allowed_functions: List of allowed function names (if specified, only these are allowed)
        blocked_functions: List of blocked function names
        
    Returns:
        List of violations
    """
    violations = []
    
    # Extract all function calls
    functions = []
    for func in parsed_sql.find_all(exp.Func):
        if hasattr(func, 'this') and func.this:
            functions.append(str(func.this).upper())
    
    # Check allowed functions (whitelist)
    if allowed_functions:
        allowed_upper = [f.upper() for f in allowed_functions]
        for func in functions:
            if func not in allowed_upper:
                violations.append(f"Function not allowed: {func}")
    
    # Check blocked functions (blacklist)
    if blocked_functions:
        blocked_upper = [f.upper() for f in blocked_functions]
        for func in functions:
            if func in blocked_upper:
                violations.append(f"Function blocked: {func}")
    
    return violations


def apply_guardrails(
    sql: str,
    policy: Dict[str, Any],
    dialect: str = "postgres"
) -> GuardrailsResult:
    """
    Apply all guardrails to a SQL query.
    
    Args:
        sql: SQL query string
        policy: Policy configuration
        dialect: SQL dialect
        
    Returns:
        GuardrailsResult with validation results and modified SQL
    """
    result = GuardrailsResult()
    
    logger.info("Applying guardrails", sql_length=len(sql), dialect=dialect)
    
    # Parse SQL
    parsed_sql, parse_errors = parse_sql(sql, dialect)
    if parse_errors:
        result.errors.extend(parse_errors)
        result.syntax_valid = False
        return result
    
    result.syntax_valid = True
    current_sql = sql
    
    # Extract tables and columns
    if parsed_sql:
        tables, columns = extract_tables_and_columns(parsed_sql)
        result.parsed_tables = tables
        result.parsed_columns = columns
    
    # Check read-only constraint
    if not policy.get("allow_write", False) and parsed_sql:
        if not check_read_only(parsed_sql):
            result.violations.append("Write operations not allowed")
            return result
    
    # Check banned items
    banned_violations = check_banned_items(
        result.parsed_tables,
        result.parsed_columns,
        policy.get("banned_tables", []),
        policy.get("banned_columns", []),
        policy.get("banned_schemas", [])
    )
    result.violations.extend(banned_violations)
    
    if result.violations:
        return result  # Don't modify SQL if there are violations
    
    # Apply PII masking
    if policy.get("pii_masking_enabled", False):
        pii_columns = policy.get("pii_tags", [])
        current_sql, pii_modifications = apply_pii_masking(current_sql, pii_columns, dialect)
        result.modifications.extend(pii_modifications)
    
    # Inject LIMIT if needed
    default_limit = policy.get("default_limit")
    if default_limit:
        current_sql, limit_injected = inject_limit(current_sql, default_limit, dialect)
        if limit_injected:
            result.modifications.append(f"Added LIMIT {default_limit}")
    
    # Validate functions
    if parsed_sql:
        function_violations = validate_functions(
            parsed_sql,
            policy.get("allowed_functions"),
            policy.get("blocked_functions")
        )
        result.violations.extend(function_violations)
    
    # Check max rows constraint
    max_rows = policy.get("max_rows_returned")
    if max_rows and parsed_sql:
        limit_node = parsed_sql.find(exp.Limit)
        if limit_node and hasattr(limit_node, 'expression'):
            try:
                limit_value = int(str(limit_node.expression))
                if limit_value > max_rows:
                    result.violations.append(f"LIMIT {limit_value} exceeds maximum allowed {max_rows}")
            except (ValueError, AttributeError):
                pass
    
    result.sql = current_sql
    
    logger.info(
        "Guardrails applied",
        syntax_valid=result.syntax_valid,
        violations=len(result.violations),
        modifications=len(result.modifications)
    )
    
    return result


def validate_sql_syntax(sql: str, dialect: str = "postgres") -> Dict[str, Any]:
    """
    Validate SQL syntax without applying guardrails.
    
    Args:
        sql: SQL query string
        dialect: SQL dialect
        
    Returns:
        Validation result dictionary
    """
    parsed_sql, errors = parse_sql(sql, dialect)
    
    result = {
        "syntax_valid": len(errors) == 0,
        "errors": errors,
        "warnings": [],
        "parsed_tables": [],
        "parsed_columns": []
    }
    
    if parsed_sql:
        tables, columns = extract_tables_and_columns(parsed_sql)
        result["parsed_tables"] = tables
        result["parsed_columns"] = columns
    
    return result 