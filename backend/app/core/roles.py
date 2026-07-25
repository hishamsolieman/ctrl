"""Canonical role definitions (ascending privilege)."""
from __future__ import annotations

# name -> level (higher is more privileged)
ROLES: dict[str, int] = {
    "Cashier": 10,
    "Moderator": 20,
    "Admin": 30,
    "SuperAdmin": 40,
}

ROLE_DESCRIPTIONS: dict[str, str] = {
    "Cashier": "Operates the point of sale.",
    "Moderator": "Manages catalog and day-to-day operations.",
    "Admin": "Full administrative access to the store.",
    "SuperAdmin": "Unrestricted, top-level system access.",
}
