"""Image storage in the DB as base64.

- POST /images  : upload a file; stored base64-encoded; returns {id, url}.
- GET  /images/{id} : serve the decoded bytes (public, so <img src> works).
"""
from __future__ import annotations

import base64
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import require_role
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


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_image(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_role("Moderator")),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported image type")
    raw = await file.read()
    mime = file.content_type if (file.content_type or "").startswith("image/") else ALLOWED[ext]
    img = Image(data=base64.b64encode(raw).decode("ascii"), mime=mime)
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
