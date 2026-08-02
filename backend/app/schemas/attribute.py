from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AttributeValueIn(BaseModel):
    id: int | None = None
    value_en: str = Field(min_length=1, max_length=120)
    value_ar: str = Field(min_length=1, max_length=120)
    extra: dict[str, Any] | None = None


class AttributeIn(BaseModel):
    # key is optional; auto-derived from name_en when omitted.
    key: str | None = Field(default=None, max_length=60)
    type: Literal["text", "number", "color"] = "text"
    name_en: str = Field(min_length=1, max_length=120)
    name_ar: str = Field(min_length=1, max_length=120)
    is_required: bool = False
    # New attributes default to global (product-level, no variant explosion).
    is_global: bool = True
    coding: bool = False
    values: list[AttributeValueIn] = Field(default_factory=list)


class AttributeValueOut(BaseModel):
    id: int
    value_en: str
    value_ar: str
    extra: dict[str, Any] | None = None


class AttributeOut(BaseModel):
    id: int
    key: str
    type: str
    name_en: str
    name_ar: str
    is_required: bool
    is_global: bool
    coding: bool
    # True when at least one product references this attribute (global / variant / stock).
    in_use: bool = False
    values: list[AttributeValueOut]
