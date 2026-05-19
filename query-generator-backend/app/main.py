"""
Query Generator Framework - Main FastAPI Application
"""
import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.qdrant_client import qdrant_store
from app.core.settings_service import seed_defaults as seed_settings_defaults
from app.deps.db import create_db_and_tables
from app.routers import (
    auth,
    catalogs,
    corrections,
    cost_summary,
    generate,
    history,
    knowledge,
    policies,
    sector_settings,
    sectors,
)
from app.routers import settings as settings_router


# Configure structured logging
structlog.configure(
    processors=[
        # Pull correlation_id (and any other bound vars) into the log event.
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer(),
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager"""
    logger.info("Starting Query Generator Framework", version="1.0.0")
    
    # Initialize database
    await create_db_and_tables()
    logger.info("Database initialized")

    # Ensure Qdrant collection + payload indexes exist (idempotent).
    try:
        qdrant_store.ensure_collection()
    except Exception as e:
        logger.error("Failed to ensure Qdrant collection", error=str(e))

    # Seed default settings so the Settings UI has rows on fresh installs.
    try:
        await seed_settings_defaults()
    except Exception as e:
        logger.error("Failed to seed default settings", error=str(e))

    yield
    
    logger.info("Shutting down Query Generator Framework")


app = FastAPI(
    title="Query Generator Framework",
    description="Natural Language to SQL Generator with RAG and Safety Guardrails",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.environment == "development" else None,
    redoc_url="/redoc" if settings.environment == "development" else None,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.environment == "development" else settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    """Attach a correlation ID to every request.

    Honours the inbound `X-Correlation-ID` header so an upstream gateway
    can propagate the ID across services; otherwise mints a fresh UUID.
    The ID is stored on `request.state.correlation_id`, returned in the
    response header, and bound into every structlog event emitted during
    the request — making it trivial to grep logs for one user's session.
    """
    correlation_id = (
        request.headers.get("X-Correlation-ID")
        or request.headers.get("X-Request-ID")
        or str(uuid.uuid4())
    )
    request.state.correlation_id = correlation_id

    # Bind to structlog contextvars so every log line in this request
    # carries the correlation_id without needing manual plumbing.
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        method=request.method,
        path=request.url.path,
    )

    logger.info("request.start")
    try:
        response = await call_next(request)
    finally:
        structlog.contextvars.unbind_contextvars(
            "correlation_id", "method", "path"
        )

    response.headers["X-Correlation-ID"] = correlation_id
    logger.info("request.end", status_code=response.status_code)
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Pass HTTP exceptions through, tagging the correlation ID."""
    cid = getattr(request.state, "correlation_id", None)
    logger.warning(
        "http_exception",
        status_code=exc.status_code,
        detail=exc.detail,
        correlation_id=cid,
    )
    body = {"detail": exc.detail}
    if cid:
        body["correlation_id"] = cid
    headers = {"X-Correlation-ID": cid} if cid else None
    return JSONResponse(status_code=exc.status_code, content=body, headers=headers)


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Catch-all: log the full trace internally, return a generic message
    + the correlation ID so the user can quote it in a bug report and the
    operator can find the trace in the logs."""
    cid = getattr(request.state, "correlation_id", None) or str(uuid.uuid4())
    logger.error(
        "unhandled_exception",
        error=str(exc),
        correlation_id=cid,
        exc_info=True,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "Internal server error",
            "correlation_id": cid,
        },
        headers={"X-Correlation-ID": cid},
    )


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "version": "1.0.0"}


# Include routers
app.include_router(auth.router, prefix="/auth", tags=["authentication"])
app.include_router(sectors.router, prefix="/v1/sectors", tags=["sectors"])
app.include_router(
    corrections.router,
    prefix="/v1/sectors/{sector_id}/corrections",
    tags=["corrections"],
)
app.include_router(
    catalogs.router,
    prefix="/v1/sectors/{sector_id}/catalogs",
    tags=["catalogs"],
)
app.include_router(
    knowledge.router,
    prefix="/v1/sectors/{sector_id}/knowledge",
    tags=["knowledge"],
)
app.include_router(
    policies.router,
    prefix="/v1/sectors/{sector_id}/catalogs/{catalog_id}/policy",
    tags=["policies"],
)
app.include_router(generate.router, prefix="/v1", tags=["generation"])
app.include_router(
    history.router,
    prefix="/v1/sectors/{sector_id}/history",
    tags=["history"],
)
app.include_router(settings_router.router, prefix="/v1/settings", tags=["settings"])
app.include_router(
    sector_settings.router,
    prefix="/v1/sectors/{sector_id}/settings",
    tags=["sector-settings"],
)
# cost_summary owns its own paths (sector + global), so no shared prefix.
app.include_router(cost_summary.router, prefix="/v1", tags=["cost"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.environment == "development",
        log_level=settings.log_level.lower(),
    ) 