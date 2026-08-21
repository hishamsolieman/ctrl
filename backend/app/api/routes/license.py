"""Public HWID check for the Tauri desktop boot gate."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.license import is_licensed, normalize_hwid
from app.services.logging import log_action

router = APIRouter(prefix="/license", tags=["license"])


class HwidCheck(BaseModel):
    hwid: str = Field(min_length=1, max_length=500)


def _hwid_hint(raw: str) -> str:
    n = normalize_hwid(raw)
    if len(n) <= 8:
        return n
    return f"{n[:4]}…{n[-4:]}"


@router.post("/check")
def check_license(payload: HwidCheck, request: Request, db: Session = Depends(get_db)):
    """Public. Called once at Tauri boot. The browser client never calls this."""
    allowed = is_licensed(db, payload.hwid)
    log_action(
        db,
        action="license.check",
        entity="settings",
        details={"hint": _hwid_hint(payload.hwid)},
        status="success" if allowed else "failure",
        request=request,
    )
    return {"allowed": allowed}
