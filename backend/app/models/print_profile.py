"""Print profile — a saved (printer + paper size) combination.

Profiles are created in Settings › Printer and then assigned to one or more
print targets (barcode / invoice / report). The actual printing happens on the
client (desktop shell, e.g. Tauri, or a browser fallback); this only stores the
configuration.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PrintProfile(Base):
    __tablename__ = "print_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    # OS printer device name (as reported by the desktop shell).
    printer_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # "standard" (named paper, e.g. A4 / 80mm) or "custom" (width x height + unit).
    size_mode: Mapped[str] = mapped_column(String(20), default="standard", nullable=False)
    standard_size: Mapped[str | None] = mapped_column(String(40), nullable=True)
    width: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    height: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    unit: Mapped[str] = mapped_column(String(4), default="mm", nullable=False)  # mm | cm | in

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
