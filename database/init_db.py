"""Initialize the CTRL database.

Creates the schema, tables, roles, the seed SuperAdmin, and starter
translations. Reads all connection info (AES-256 encrypted) from the root .env.

Run:
    python database/init_db.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the backend package importable regardless of CWD.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.initialize import run  # noqa: E402

if __name__ == "__main__":
    run()
