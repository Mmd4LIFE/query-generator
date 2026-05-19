"""
Audit-log helper. Routers call `write_audit(...)` to stage an audit row, then
commit it themselves alongside (or after) the action being audited.

Why no internal commit? — keeping the audit write under the *caller's* commit
window makes the audit row atomic with the change it describes. If the caller
chooses to commit twice (mutation first, audit second) — as `routers/sectors.py`
does — the audit row simply lands a moment later, which is the right trade-off:
audit is observability, not a transactional precondition.
"""
import uuid
from typing import Any, Dict, Optional

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog

logger = structlog.get_logger()


async def write_audit(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID,
    action: str,
    sector_id: Optional[uuid.UUID] = None,
    target_type: Optional[str] = None,
    target_id: Optional[uuid.UUID] = None,
    diff: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    """Stage an `AuditLog` row on the given session. Caller commits.

    `action` is a dotted string identifying the operation
    (e.g. `sector.create`, `member.assign`, `policy.update`).
    """
    row = AuditLog(
        actor_id=actor_id,
        action=action,
        sector_id=sector_id,
        target_type=target_type,
        target_id=target_id,
        diff=diff,
    )
    db.add(row)
    logger.info(
        "audit.staged",
        action=action,
        actor_id=str(actor_id),
        sector_id=str(sector_id) if sector_id else None,
        target_type=target_type,
        target_id=str(target_id) if target_id else None,
    )
    return row
