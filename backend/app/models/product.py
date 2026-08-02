"""Product model with variants.

- A ``Product`` holds the shared info (name, description, category, supplier,
  prices, note, tags).
- Each ``ProductVariant`` is the *code unit*: one per unique combination of the
  *coding* attribute values. It owns the unique ``code`` and the images (images
  are shared across the variant's stock units). A product always has at least one
  variant; with no coding attributes it has a single implicit variant.
- ``ProductVariant.attributes`` is a JSON map ``{attribute_id: attribute_value_id}``
  holding only the *coding* attributes (the ones that compose the code).
- ``VariantStock`` is the sellable stock unit under a variant: one per unique
  combination of the *non-global, non-coding* attribute values, with its own
  ``quantity``. A variant with no such attributes has a single implicit stock.
- ``Product.attributes`` holds the *global* attribute selections shared across the
  whole product.
- Prices use 2-decimal precision (DECIMAL(12,2)). A variant's quantity is the sum
  of its stock quantities; a product's quantity is the sum across its variants.
  Deletion is a SOFT delete.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # The product's own identifier: 8-char uppercase alphanumeric, unique.
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id"), nullable=True, index=True
    )
    supplier_id: Mapped[int | None] = mapped_column(
        ForeignKey("suppliers.id"), nullable=True, index=True
    )

    # Money is stored with 2-decimal precision (e.g. 400.00).
    supplier_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    min_price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    price: Mapped[float] = mapped_column(Numeric(12, 2), default=0)

    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Global (non-coding) attribute selections shared by all variants:
    # {attribute_id: attribute_value_id}
    attributes: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    category: Mapped["Category"] = relationship(back_populates="products")  # noqa: F821
    supplier: Mapped["Supplier"] = relationship(back_populates="products")  # noqa: F821
    variants: Mapped[list["ProductVariant"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductVariant.id",
    )


class ProductVariant(Base):
    __tablename__ = "product_variants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Unique code: exactly 8 uppercase alphanumeric chars (auto or custom).
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    # {attribute_id: attribute_value_id} — coding attributes only.
    attributes: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Legacy column: on-hand is now tracked per VariantStock. Kept for migration
    # (the initial stock backfill reads it) and backward compatibility.
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    product: Mapped["Product"] = relationship(back_populates="variants")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="variant",
        cascade="all, delete-orphan",
        order_by="ProductImage.sort_order",
    )
    stocks: Mapped[list["VariantStock"]] = relationship(
        back_populates="variant",
        cascade="all, delete-orphan",
        order_by="VariantStock.id",
    )


class VariantStock(Base):
    """Sellable stock unit: a combination of non-global, non-coding attribute
    values under a variant, with its own on-hand quantity. A variant with no such
    attributes has exactly one stock (attributes == {})."""

    __tablename__ = "product_variant_stocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    variant_id: Mapped[int] = mapped_column(
        ForeignKey("product_variants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # {attribute_id: attribute_value_id} — non-global, non-coding attributes only.
    attributes: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    variant: Mapped["ProductVariant"] = relationship(back_populates="stocks")


class ProductImage(Base):
    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    variant_id: Mapped[int] = mapped_column(
        ForeignKey("product_variants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(String(512), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    variant: Mapped["ProductVariant"] = relationship(back_populates="images")
