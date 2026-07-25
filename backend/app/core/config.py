"""Application configuration.

Loads the *root* ``.env`` (single source of truth) and exposes typed settings.
Database credentials are stored AES-256 encrypted (``DB_*_ENC``) and decrypted
here via :mod:`app.core.crypto`.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

from app.core.crypto import decrypt

# Resolve the root .env (../../.. from this file: core -> app -> backend -> root)
ROOT_DIR = Path(__file__).resolve().parents[3]
ENV_PATH = ROOT_DIR / ".env"
load_dotenv(ENV_PATH)


def _dec(key: str, default: str = "") -> str:
    """Decrypt an AES-256 encrypted env value; empty string if unset."""
    token = os.environ.get(key, "").strip()
    if not token:
        return default
    return decrypt(token)


class Settings:
    # --- Brand (fallback only) ---------------------------------------------
    # The authoritative brand name/motto now live in the DB `settings` table.
    # These act as a bootstrap fallback (e.g. before the DB is reachable).
    BRAND_NAME: str = os.environ.get("VITE_BRAND_NAME", "CTRL")
    BRAND_MOTTO: str = os.environ.get("VITE_BRAND_MOTTO", "Stay in CTRL.")

    # --- Server ------------------------------------------------------------
    HOST: str = os.environ.get("BACKEND_HOST", "0.0.0.0")
    PORT: int = int(os.environ.get("BACKEND_PORT", "2830"))

    # NOTE: Auth/JWT configuration is embedded in app.core.security (not .env).

    # --- CORS --------------------------------------------------------------
    CORS_ORIGINS: list[str] = [
        o.strip()
        for o in os.environ.get(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if o.strip()
    ]

    # --- Database (decrypted from AES-256 _ENC values) ---------------------
    DB_HOST: str = _dec("DB_HOST_ENC", "127.0.0.1")
    DB_PORT: str = _dec("DB_PORT_ENC", "3306")
    DB_USER: str = _dec("DB_USER_ENC", "root")
    DB_PASSWORD: str = _dec("DB_PASSWORD_ENC", "")
    DB_NAME: str = _dec("DB_NAME_ENC", "ctrl")

    @property
    def database_url(self) -> str:
        pwd = self.DB_PASSWORD
        return (
            f"mysql+pymysql://{self.DB_USER}:{pwd}@"
            f"{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"
        )

    @property
    def server_url_no_db(self) -> str:
        """Connection URL without a specific database (for creation)."""
        pwd = self.DB_PASSWORD
        return (
            f"mysql+pymysql://{self.DB_USER}:{pwd}@"
            f"{self.DB_HOST}:{self.DB_PORT}/?charset=utf8mb4"
        )


@lru_cache
def get_settings() -> "Settings":
    return Settings()


settings = get_settings()
