# Database Engine Logos

This folder contains PNG logo files for database engines.

## Required Logo Files

Place PNG logo files in this directory with the following names:

### Complete Support
- `postgresql.png` - PostgreSQL
- `mysql.png` - MySQL
- `mssql.png` - Microsoft SQL Server
- `oracle.png` - Oracle
- `snowflake.png` - Snowflake
- `amazon_aurora_mysql.png` - Amazon Aurora MySQL
- `amazon_redshift.png` - Amazon Redshift
- `bigquery.png` - Google BigQuery
- `azure_sql.png` - Azure SQL Database
- `mariadb.png` - MariaDB

### Basic Support
- `sqlite.png` - SQLite
- `cockroachdb.png` - CockroachDB

### Other
- `mongodb.png` - MongoDB

## Logo Requirements

- **Format**: PNG with transparent background preferred
- **Size**: Recommended 256x256px or higher (will be displayed at 20x20px or 24x24px)
- **Quality**: High resolution for crisp display
- **Naming**: Must match the engine value exactly (case-sensitive)

## Where Logos Are Used

The logos appear in:
1. Database engine selector dropdown
2. SQL query export section header
3. Catalog management interface

## Fallback

If a logo is missing, the Image component will show a broken image or Next.js will display an error in development mode.

