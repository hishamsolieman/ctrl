"""Entrypoint. Host/port come from the root .env (BACKEND_HOST/BACKEND_PORT)."""
from __future__ import annotations

import uvicorn

from app.core.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )
