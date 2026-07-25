"""AES-256-GCM helper for encrypting/decrypting DB credentials.

The 32-byte key is *fixed in the backend* (per project spec). All sensitive
database connection values are stored AES-256 encrypted in the root ``.env``
as ``DB_*_ENC`` and decrypted here at startup.

Token format: base64( nonce(12) || ciphertext || tag(16) ).

CLI usage (to generate values for the .env file):

    python -m app.core.crypto encrypt "127.0.0.1"
    python -m app.core.crypto decrypt "<token>"
"""
from __future__ import annotations

import base64
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# --- Fixed AES-256 key (32 bytes) -------------------------------------------
# NOTE: This key intentionally lives in the backend source per project spec.
# Rotating it requires re-encrypting every DB_*_ENC value in the root .env.
_AES_KEY: bytes = bytes.fromhex(
    "9f2b7c1e4a6d8f0b3c5e7a9d1f2b4c6e8a0d2f4b6c8e0a1d3f5b7c9e1a2d4f6b"
)

_NONCE_SIZE = 12


def encrypt(plaintext: str) -> str:
    """Encrypt a UTF-8 string, returning a base64 token."""
    aes = AESGCM(_AES_KEY)
    nonce = os.urandom(_NONCE_SIZE)
    ct = aes.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def decrypt(token: str) -> str:
    """Decrypt a base64 token produced by :func:`encrypt`."""
    raw = base64.b64decode(token)
    nonce, ct = raw[:_NONCE_SIZE], raw[_NONCE_SIZE:]
    aes = AESGCM(_AES_KEY)
    return aes.decrypt(nonce, ct, None).decode("utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("encrypt", "decrypt"):
        print("usage: python -m app.core.crypto <encrypt|decrypt> <value>")
        raise SystemExit(1)
    op, value = sys.argv[1], sys.argv[2]
    print(encrypt(value) if op == "encrypt" else decrypt(value))
