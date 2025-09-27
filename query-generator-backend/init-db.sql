-- This script runs automatically when the PostgreSQL container starts

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create database if it doesn't exist (already created by POSTGRES_DB)
-- The database 'qg' will be automatically created by the postgres image

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE qg TO qg; 