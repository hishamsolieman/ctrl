"""Business expense recorded by a user.

`user_id` is who the expense belongs to; `created_by_id` is who recorded it
(differs when an Admin adds an expense on behalf of someone). `type` is one of
the known expense-type keys; when it is ``other`` the free-text `name` holds the
custom label.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    type: Mapped[str] = mapped_column(String(40), nullable=False)
    # Custom label when type == 'other'.
    name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    spent_at: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="joined")  # noqa: F821
    creator: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[created_by_id], lazy="joined"
    )
