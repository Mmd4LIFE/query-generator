// Catalog creation utilities for Query Generator

export interface DatabaseEngine {
  value: string
  label: string
  informationSchemaQuery: string
  defaultPort: number
  connectionStringTemplate: string
  category?: 'complete' | 'basic' | 'other'
}

// Supported database engines with their information schema queries
export const DATABASE_ENGINES: DatabaseEngine[] = [
  // Complete Support
  {
    value: 'postgresql',
    label: 'PostgreSQL',
    category: 'complete',
    defaultPort: 5432,
    connectionStringTemplate: 'postgresql://user:password@host:port/database',
    informationSchemaQuery: `SELECT 
    table_schema as schema_name,
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length,
    numeric_precision,
    numeric_scale,
    ordinal_position,
    col_description((table_schema||'.'||table_name)::regclass, ordinal_position) as column_comment
FROM information_schema.columns 
WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
ORDER BY table_schema, table_name, ordinal_position;`.trim()
  },
  {
    value: 'mysql',
    label: 'MySQL',
    category: 'complete',
    defaultPort: 3306,
    connectionStringTemplate: 'mysql://user:password@host:port/database',
    informationSchemaQuery: `SELECT 
    table_schema as schema_name,
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length,
    numeric_precision,
    numeric_scale,
    ordinal_position,
    column_comment
FROM information_schema.columns 
WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY table_schema, table_name, ordinal_position;`.trim()
  },
  {
    value: 'mssql',
    label: 'Microsoft SQL Server',
    category: 'complete',
    defaultPort: 1433,
    connectionStringTemplate: 'mssql://user:password@host:port/database',
    informationSchemaQuery: `SELECT 
    SCHEMA_NAME(t.schema_id) as schema_name,
    t.name as table_name,
    c.name as column_name,
    ty.name as data_type,
    CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END as is_nullable,
    dc.definition as column_default,
    c.max_length as character_maximum_length,
    c.precision as numeric_precision,
    c.scale as numeric_scale,
    c.column_id as ordinal_position,
    ep.value as column_comment
FROM sys.tables t
INNER JOIN sys.columns c ON t.object_id = c.object_id
INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
LEFT JOIN sys.extended_properties ep ON t.object_id = ep.major_id AND c.column_id = ep.minor_id AND ep.name = 'MS_Description'
WHERE t.is_ms_shipped = 0
ORDER BY schema_name, table_name, ordinal_position;`.trim()
  },
  {
    value: 'oracle',
    label: 'Oracle',
    category: 'complete',
    defaultPort: 1521,
    connectionStringTemplate: 'oracle://user:password@host:port/database',
    informationSchemaQuery: `SELECT 
    atc.owner as schema_name,
    atc.table_name,
    atc.column_name,
    atc.data_type,
    atc.nullable as is_nullable,
    atc.data_default as column_default,
    atc.char_length as character_maximum_length,
    atc.data_precision as numeric_precision,
    atc.data_scale as numeric_scale,
    atc.column_id as ordinal_position,
    acc.comments as column_comment
FROM all_tab_columns atc
LEFT JOIN all_col_comments acc ON atc.owner = acc.owner 
    AND atc.table_name = acc.table_name 
    AND atc.column_name = acc.column_name
WHERE atc.owner NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'SYSMAN', 'OUTLN', 'CTXSYS', 'XDB', 'MDSYS', 'WMSYS')
ORDER BY atc.owner, atc.table_name, atc.column_id;`.trim()
  },
  {
    value: 'snowflake',
    label: 'Snowflake',
    category: 'complete',
    defaultPort: 443,
    connectionStringTemplate: 'snowflake://user:password@account.region/database?warehouse=warehouse&schema=schema',
    informationSchemaQuery: `SELECT 
    table_schema as schema_name,
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length,
    numeric_precision,
    numeric_scale,
    ordinal_position,
    comment as column_comment
FROM information_schema.columns 
WHERE table_schema NOT IN ('INFORMATION_SCHEMA')
ORDER BY table_schema, table_name, ordinal_position;`.trim()
  },
  {
    value: 'bigquery',
    label: 'BigQuery',
    category: 'complete',
    defaultPort: 443,
    connectionStringTemplate: 'bigquery://project/dataset',
    informationSchemaQuery: `SELECT 
    table_schema as schema_name,
    table_name,
    column_name,
    data_type,
    is_nullable,
    '' as column_default,
    '' as character_maximum_length,
    '' as numeric_precision,
    '' as numeric_scale,
    ordinal_position,
    '' as column_comment
FROM \`project.dataset.INFORMATION_SCHEMA.COLUMNS\`
ORDER BY table_schema, table_name, ordinal_position;`.trim()
  },
  {
    value: 'mariadb',
    label: 'MariaDB',
    category: 'complete',
    defaultPort: 3306,
    connectionStringTemplate: 'mariadb://user:password@host:port/database',
    informationSchemaQuery: `SELECT 
    table_schema as schema_name,
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length,
    numeric_precision,
    numeric_scale,
    ordinal_position,
    column_comment
FROM information_schema.columns 
WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY table_schema, table_name, ordinal_position;`.trim()
  },
  
  // Basic Support
  {
    value: 'sqlite',
    label: 'SQLite',
    category: 'basic',
    defaultPort: 0,
    connectionStringTemplate: 'sqlite:///path/to/database.db',
    informationSchemaQuery: `SELECT 
    '' as schema_name,
    m.name as table_name,
    p.name as column_name,
    p.type as data_type,
    CASE WHEN p.notnull = 0 THEN 'YES' ELSE 'NO' END as is_nullable,
    p.dflt_value as column_default,
    '' as character_maximum_length,
    '' as numeric_precision,
    '' as numeric_scale,
    p.cid as ordinal_position,
    '' as column_comment
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, p.cid;`.trim()
  },
]

// Helper function to get database engine logo path
export function getDatabaseLogo(engineValue: string): string {
  return `/database-logos/${engineValue}.png`
}

// CSV column mapping for information_schema.columns
export interface ColumnInfo {
  schema_name: string
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
  column_default?: string
  character_maximum_length?: number
  numeric_precision?: number
  numeric_scale?: number
  ordinal_position: number
  column_comment?: string
}

// Parse CSV content to column information
export function parseColumnsCSV(csvContent: string): ColumnInfo[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length === 0) return []
  
  // Parse header (normalize to lowercase)
  const originalHeaders = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
  const headers = originalHeaders.map(h => h.toLowerCase())
  
  console.log('Original headers:', originalHeaders)
  console.log('Normalized headers:', headers)
  
  // Parse data rows
  const columns: ColumnInfo[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    if (values.length >= headers.length) {
      const column: any = {}
      headers.forEach((header, index) => {
        column[header] = values[index] || ''
      })
      
      // Convert data types
      column.ordinal_position = parseInt(column.ordinal_position) || i
      if (column.character_maximum_length) {
        column.character_maximum_length = parseInt(column.character_maximum_length)
      }
      if (column.numeric_precision) {
        column.numeric_precision = parseInt(column.numeric_precision)
      }
      if (column.numeric_scale) {
        column.numeric_scale = parseInt(column.numeric_scale)
      }
      
      columns.push(column as ColumnInfo)
    }
  }
  
  return columns
}

// Parse a CSV line handling quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  
  result.push(current.trim())
  return result
}

// Convert column information to catalog JSON format
export function convertColumnsToCatalogJSON(
  columns: ColumnInfo[],
  catalogName: string,
  engine: string,
  description?: string
): any {
  // Group columns by schema and table
  const schemaMap = new Map<string, Map<string, ColumnInfo[]>>()
  
  columns.forEach(column => {
    if (!schemaMap.has(column.schema_name)) {
      schemaMap.set(column.schema_name, new Map())
    }
    
    const tableMap = schemaMap.get(column.schema_name)!
    if (!tableMap.has(column.table_name)) {
      tableMap.set(column.table_name, [])
    }
    
    tableMap.get(column.table_name)!.push(column)
  })
  
  // Convert to catalog format
  const schemas = Array.from(schemaMap.entries()).map(([schemaName, tableMap]) => ({
    name: schemaName,
    tables: Array.from(tableMap.entries()).map(([tableName, tableColumns]) => {
      // Sort columns by ordinal position
      const sortedColumns = tableColumns.sort((a, b) => a.ordinal_position - b.ordinal_position)
      
      // Find primary key columns (basic heuristic)
      const primaryKeyColumns = sortedColumns
        .filter(col => 
          col.column_name.toLowerCase().includes('id') && 
          col.ordinal_position <= 3 &&
          (col.is_nullable === 'NO' || col.is_nullable === 'false')
        )
        .map(col => col.column_name)
      
      return {
        name: tableName,
        comment: `Table: ${tableName}`,
        primary_key: primaryKeyColumns.length > 0 ? primaryKeyColumns : [sortedColumns[0]?.column_name],
        columns: sortedColumns.map(col => ({
          name: col.column_name,
          data_type: formatDataType(col, engine),
          nullable: col.is_nullable === 'YES' || col.is_nullable === 'true',
          comment: col.column_comment || `${col.column_name} column`,
          ...(col.column_default && { default_value: col.column_default })
        }))
      }
    })
  }))
  
  const version = new Date().toISOString()
  
  return {
    engine: engine,
    catalog_name: catalogName,
    version: version,
    description: description || `${catalogName} database schema`,
    is_active: true,
    raw_json: {
      engine: engine,
      catalog_name: catalogName,
      version: version,
      schemas: schemas
    }
  }
}

// Format data type based on engine
function formatDataType(column: ColumnInfo, engine: string): string {
  let dataType = column.data_type.toLowerCase()
  
  // Add length/precision information where available
  if (column.character_maximum_length && 
      (dataType.includes('varchar') || dataType.includes('char') || dataType.includes('text'))) {
    return `${dataType}(${column.character_maximum_length})`
  }
  
  if (column.numeric_precision && 
      (dataType.includes('decimal') || dataType.includes('numeric'))) {
    if (column.numeric_scale) {
      return `${dataType}(${column.numeric_precision},${column.numeric_scale})`
    } else {
      return `${dataType}(${column.numeric_precision})`
    }
  }
  
  return dataType
}

// Generate sample CSV template for each engine
export function generateSampleCSV(engine: string): string {
  const headers = [
    'schema_name',
    'table_name', 
    'column_name',
    'data_type',
    'is_nullable',
    'column_default',
    'character_maximum_length',
    'numeric_precision',
    'numeric_scale',
    'ordinal_position',
    'column_comment'
  ]
  
  const sampleData = [
    ['public', 'users', 'user_id', 'bigint', 'NO', '', '', '', '', '1', 'Unique user identifier'],
    ['public', 'users', 'username', 'varchar', 'NO', '', '50', '', '', '2', 'User login name'],
    ['public', 'users', 'email', 'varchar', 'NO', '', '255', '', '', '3', 'User email address'],
    ['public', 'users', 'created_at', 'timestamp', 'NO', 'CURRENT_TIMESTAMP', '', '', '', '4', 'Account creation date'],
    ['public', 'orders', 'order_id', 'bigint', 'NO', '', '', '', '', '1', 'Unique order identifier'],
    ['public', 'orders', 'user_id', 'bigint', 'NO', '', '', '', '', '2', 'Reference to users table'],
    ['public', 'orders', 'amount', 'decimal', 'NO', '', '', '10', '2', '3', 'Order amount in USD']
  ]
  
  const csvLines = [headers.join(',')]
  sampleData.forEach(row => {
    csvLines.push(row.map(cell => `"${cell}"`).join(','))
  })
  
  return csvLines.join('\n')
}

// Validate CSV format
export function validateColumnsCSV(csvContent: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  try {
    const lines = csvContent.trim().split('\n')
    
    if (lines.length < 2) {
      errors.push('CSV must have at least a header row and one data row')
      return { valid: false, errors }
    }
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase())
    const requiredHeaders = ['schema_name', 'table_name', 'column_name', 'data_type', 'is_nullable']
    
    console.log('CSV headers found:', headers)
    console.log('Required headers:', requiredHeaders)
    
    const missingHeaders = requiredHeaders.filter(req => !headers.includes(req))
    if (missingHeaders.length > 0) {
      errors.push(`Missing required columns: ${missingHeaders.join(', ')}`)
      errors.push(`Found headers: ${headers.join(', ')}`)
    }
    
    // Validate data rows
    for (let i = 1; i < Math.min(lines.length, 6); i++) { // Check first 5 rows
      const values = parseCSVLine(lines[i])
      if (values.length < requiredHeaders.length) {
        errors.push(`Row ${i}: Insufficient columns (expected at least ${requiredHeaders.length}, got ${values.length})`)
      }
      
      // Check for empty required fields
      requiredHeaders.forEach((header) => {
        const headerIndex = headers.indexOf(header)
        if (headerIndex !== -1) {
          if (!values[headerIndex] || values[headerIndex].trim() === '') {
            errors.push(`Row ${i}: Empty value for required field '${header}'`)
          }
        }
      })
    }
    
  } catch (error) {
    errors.push(`CSV parsing error: ${error}`)
  }
  
  return {
    valid: errors.length === 0,
    errors
  }
} 