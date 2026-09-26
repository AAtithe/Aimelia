"""
One access check for every route that can reach Tom's data or Microsoft 365.

Callers send X-Aimelia-Key matching AIMELIA_ACCESS_KEY. It fails closed: with no
key configured on the server, every protected route refuses.
Public routes are only: /, /health, /auth/login and /auth/callback.
"""
import hmac
from typing import Optional

from fastapi import Header, HTTPException

from .settings import settings


def require_access_key(x_aimelia_key: Optional[str] = Header(default=None)) -> None:
    expected = settings.AIMELIA_ACCESS_KEY
    if not expected:
        raise HTTPException(503, "AIMELIA_ACCESS_KEY is not configured on the server.")
    if not x_aimelia_key or not hmac.compare_digest(x_aimelia_key.encode(), expected.encode()):
        raise HTTPException(401, "Invalid or missing access key.")
