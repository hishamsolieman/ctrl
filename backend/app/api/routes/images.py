"""Image storage in the DB as base64.

- POST /images  : upload a file; stored base64-encoded; returns {id, url}.
- GET  /images/{id} : serve the decoded bytes (public, so <img src> works).
"""
from __future__ import annotations

import base64
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.image import Image
from app.models.user import User

router = APIRouter(prefix="/images", tags=["images"])

ALLOWED = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}

# Cached max base64 length an INSERT can carry, derived from the server's
# `max_allowed_packet` (leaving headroom for the rest of the statement). Storing
# a larger base64 blob would exceed the packet and drop the DB connection.
_MAX_B64_LEN: int | None = None


def _max_b64_len(db: Session) -> int:
    global _MAX_B64_LEN
    if _MAX_B64_LEN is None:
        packet = 1_048_576
        try:
            row = db.execute(text("SHOW VARIABLES LIKE 'max_allowed_packet'")).fetchone()
            if row and row[1]:
                packet = int(row[1])
        except Exception:  # noqa: BLE001
            pass
        _MAX_B64_LEN = max(packet - 16_384, 16_384)
    return _MAX_B64_LEN


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "products.modal.imageUnsupported")
    raw = await file.read()
    b64 = base64.b64encode(raw).decode("ascii")
    # Guard: reject anything that would overflow the DB packet (safety net —
    # the client already downscales images to <=512KB before upload).
    if len(b64) > _max_b64_len(db):
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "products.errors.imageTooLarge"
        )
    mime = file.content_type if (file.content_type or "").startswith("image/") else ALLOWED[ext]
    img = Image(data=b64, mime=mime)
    db.add(img)
    db.commit()
    db.refresh(img)
    return {"id": img.id, "url": f"/images/{img.id}"}


@router.get("/{image_id}")
def serve_image(image_id: int, db: Session = Depends(get_db)):
    img = db.get(Image, image_id)
    if not img:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    try:
        raw = base64.b64decode(img.data)
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Corrupt image")
    return Response(content=raw, media_type=img.mime,
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})
