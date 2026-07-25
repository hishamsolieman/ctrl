"""Role model. Roles: Cashier < Moderator < Admin < SuperAdmin."""
from __future__ import annotations

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # machine name, e.g. "SuperAdmin"
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    # numeric privilege level; higher = more privileged
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    users: Mapped[list["User"]] = relationship(back_populates="role")  # noqa: F821
