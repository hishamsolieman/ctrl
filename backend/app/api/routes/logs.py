"""Action-log browser — SuperAdmin only.

A master/detail view over ``action_logs``: pick a user (or all users), scroll a
keyset-paginated vertical activity timeline (load-more by id), and inspect the
full JSON details of any entry.
"""
from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.database import get_db
from app.models.action_log import ActionLog
from app.models.user import User
from app.services.logging import log_action

router = APIRouter(prefix="/logs", tags=["logs"])

PAGE = 20


def _parse_details(raw: str | None):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw  # keep the raw string if it isn't valid JSON


def _serialize(row: ActionLog, username: str | None) -> dict:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "username": username,
        "action": row.action,
        "entity": row.entity,
        "entity_id": row.entity_id,
        "status": row.status,
        "ip_address": row.ip_address,
        "user_agent": row.user_agent,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "details": _parse_details(row.details),
    }


@router.get("/users")
def log_users(db: Session = Depends(get_db), _u: User = Depends(require_role("SuperAdmin"))):
    """All users plus their log counts, for the left-hand selector."""
    counts = dict(
        db.query(ActionLog.user_id, func.count(ActionLog.id))
        .group_by(ActionLog.user_id)
        .all()
    )
    users = db.query(User).order_by(func.lower(User.username)).all()
    total = db.query(func.count(ActionLog.id)).scalar() or 0
    return {
        "total": int(total),
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "full_name": u.full_name,
                "role": u.role.name if u.role else "",
                "count": int(counts.get(u.id, 0)),
            }
            for u in users
        ],
    }


def _parse_dt(raw: str | None) -> datetime | None:
    """Parse an ISO datetime; a bare date (YYYY-MM-DD) is accepted as midnight."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.strip())
    except ValueError:
        return None


@router.get("")
def list_logs(
    user_id: int | None = Query(None),
    q: str = Query("", max_length=120),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    before_id: int | None = Query(None),
    limit: int = Query(PAGE, ge=1, le=50),
    db: Session = Depends(get_db),
    _u: User = Depends(require_role("SuperAdmin")),
):
    query = db.query(ActionLog)
    if user_id is not None:
        query = query.filter(ActionLog.user_id == user_id)
    s = q.strip()
    if s:
        like = f"%{s}%"
        query = query.filter(
            or_(
                ActionLog.action.ilike(like),
                ActionLog.entity.ilike(like),
                ActionLog.entity_id.ilike(like),
                ActionLog.details.ilike(like),
            )
        )
    dt_from = _parse_dt(date_from)
    if dt_from is not None:
        query = query.filter(ActionLog.created_at >= dt_from)
    dt_to = _parse_dt(date_to)
    if dt_to is not None:
        query = query.filter(ActionLog.created_at <= dt_to)
    if before_id is not None:
        query = query.filter(ActionLog.id < before_id)

    rows = query.order_by(ActionLog.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    # Resolve usernames in one query.
    uids = {r.user_id for r in rows if r.user_id}
    names = dict(db.query(User.id, User.username).filter(User.id.in_(uids)).all()) if uids else {}

    return {
        "items": [_serialize(r, names.get(r.user_id)) for r in rows],
        "has_more": has_more,
        "next_before_id": rows[-1].id if rows else None,
    }


@router.delete("")
def clear_logs(
    request: Request,
    user_id: int | None = Query(None),
    db: Session = Depends(get_db),
    actor: User = Depends(require_role("SuperAdmin")),
):
    """Purge logs — for a single user (``user_id``) or every entry (omitted).

    The purge itself is written back to the (now-empty) log as an audit trail.
    """
    q = db.query(ActionLog)
    target_name = None
    if user_id is not None:
        q = q.filter(ActionLog.user_id == user_id)
        target_name = db.query(User.username).filter(User.id == user_id).scalar()
    deleted = q.delete(synchronize_session=False)
    db.commit()

    log_action(
        db,
        action="logs.clear",
        user_id=actor.id,
        entity="action_logs",
        entity_id=str(user_id) if user_id is not None else "all",
        details={
            "scope": "user" if user_id is not None else "all",
            "target_user_id": user_id,
            "target_username": target_name,
            "deleted": int(deleted),
        },
        request=request,
    )
    return {"deleted": int(deleted)}


@router.get("/{log_id}")
def get_log(log_id: int, db: Session = Depends(get_db),
            _u: User = Depends(require_role("SuperAdmin"))):
    row = db.get(ActionLog, log_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Log not found")
    username = None
    if row.user_id:
        username = db.query(User.username).filter(User.id == row.user_id).scalar()
    return _serialize(row, username)
