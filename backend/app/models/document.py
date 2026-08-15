"""Downloadable binary documents stored in the DB as base64 (like images).

Used for reference guides (e.g. the funds financial-metrics PDFs) so the running
app serves them from the database instead of the local ``ref/documents`` folder.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AppDocument(Base):
    __tablename__ = "app_documents"
    __table_args__ = (
        UniqueConstraint("doc_key", "locale", name="uq_app_documents_key_locale"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Logical group (e.g. "funds_metrics") + locale ("en"/"ar") identify a file.
    doc_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    locale: Mapped[str] = mapped_column(String(10), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime: Mapped[str] = mapped_column(String(100), nullable=False, default="application/pdf")
    # Raw base64 (no data-URI prefix); decoded on the way out.
    data: Mapped[str] = mapped_column(LONGTEXT, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
