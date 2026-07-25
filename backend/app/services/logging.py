"""Action logging helper. Never let logging break the primary request path."""
from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.action_log import ActionLog


def log_action(
    db: Session,
    *,
    action: str,
    user_id: int | None = None,
    entity: str | None = None,
    entity_id: str | int | None = None,
    details: dict[str, Any] | None = None,
    status: str = "success",
    request: Request | None = None,
) -> None:
    try:
        ip = None
        ua = None
        if request is not None:
            ip = request.client.host if request.client else None
            ua = request.headers.get("user-agent")
        row = ActionLog(
            user_id=user_id,
            action=action,
            entity=entity,
            entity_id=str(entity_id) if entity_id is not None else None,
            details=json.dumps(details, ensure_ascii=False) if details else None,
            status=status,
            ip_address=ip,
            user_agent=(ua[:255] if ua else None),
        )
        db.add(row)
        db.commit()
    except Exception:
        # Logging must never break the request; roll back and continue.
        try:
            db.rollback()
        except Exception:
            pass
