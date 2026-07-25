from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AttributeValueIn(BaseModel):
    id: int | None = None
    value_en: str = Field(min_length=1, max_length=120)
    value_ar: str = Field(min_length=1, max_length=120)
    extra: dict[str, Any] | None = None


class AttributeIn(BaseModel):
    key: str = Field(min_length=1, max_length=60)
    name_en: str = Field(min_length=1, max_length=120)
    name_ar: str = Field(min_length=1, max_length=120)
    values: list[AttributeValueIn] = Field(default_factory=list)


class AttributeValueOut(BaseModel):
    id: int
    value_en: str
    value_ar: str
    extra: dict[str, Any] | None


class AttributeOut(BaseModel):
    id: int
    key: str
    name_en: str
    name_ar: str
    values: list[AttributeValueOut]
