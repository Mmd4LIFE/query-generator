"""
Configuration settings for the Query Generator Framework
"""
import os
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings"""
    
    # Database
    database_url: str = Field(..., env="DATABASE_URL")
    
    # OpenAI
    openai_api_key: str = Field(..., env="OPENAI_API_KEY")
    embed_model: str = Field(default="text-embedding-3-large", env="EMBED_MODEL")
    gen_model: str = Field(default="gpt-4o", env="GEN_MODEL")
    
    # Security
    secret_key: str = Field(..., env="SECRET_KEY")
    algorithm: str = Field(default="HS256", env="ALGORITHM")
    access_token_expire_minutes: int = Field(default=1440, env="ACCESS_TOKEN_EXPIRE_MINUTES")
    
    # Application
    environment: str = Field(default="development", env="ENVIRONMENT")
    log_level: str = Field(default="INFO", env="LOG_LEVEL")
    
    # Embedding settings
    max_chunks: int = Field(default=12, env="MAX_CHUNKS")
    embedding_dimension: int = Field(default=3072, env="EMBEDDING_DIMENSION")
    batch_size: int = Field(default=64, env="BATCH_SIZE")
    
    # Generation settings
    max_tokens: int = Field(default=2000, env="MAX_TOKENS")
    temperature: float = Field(default=0.1, env="TEMPERATURE")
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings() 