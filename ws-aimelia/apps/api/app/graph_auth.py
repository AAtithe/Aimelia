"""
Microsoft 365 sign-in for Aimelia.

Security rules this module enforces:
- No route ever returns an access or refresh token. The browser only learns
  whether Aimelia is connected; tokens stay encrypted on the server.
- The sign-in is bound to the browser that started it (signed, expiring state
  plus a matching cookie), so a sign-in cannot be forged from another site.
- Only the owner's account can connect. Whoever signs in is checked against
  AIMELIA_OWNER_EMAIL before anything is stored, so nobody else in the tenant
  can swap their mailbox in for Tom's.
- /login and /callback are public (Microsoft redirects the browser to them);
  every other route here needs the access key.
"""
import logging
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from .db import get_db
from .security import require_access_key
from .settings import settings
from .token_manager import token_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

auth_base = "https://login.microsoftonline.com"
STATE_COOKIE = "aimelia_oauth"
STATE_MAX_AGE = 600  # seconds a sign-in may take


def auth_urls():
    tenant = settings.TENANT_ID
    return {
        "authorize": f"{auth_base}/{tenant}/oauth2/v2.0/authorize",
        "token": f"{auth_base}/{tenant}/oauth2/v2.0/token",
    }


SCOPES = [
    "offline_access",
    "https://graph.microsoft.com/Mail.ReadWrite",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/Calendars.ReadWrite",
    "https://graph.microsoft.com/User.Read",
]


def _serializer() -> URLSafeTimedSerializer:
    secret = settings.AIMELIA_ACCESS_KEY or settings.ENCRYPTION_KEY
    if not secret:
        raise RuntimeError("AIMELIA_ACCESS_KEY is not configured on the server.")
    return URLSafeTimedSerializer(secret, salt="aimelia-oauth-state")


def _owners() -> set:
    return {e.strip().lower() for e in (settings.AIMELIA_OWNER_EMAIL or "").split(",") if e.strip()}


def _frontend(result: str, reason: str = "") -> RedirectResponse:
    query = urlencode({"auth": result, **({"reason": reason} if reason else {})})
    response = RedirectResponse(url=f"{settings.AIMELIA_FRONTEND_URL.rstrip('/')}/?{query}")
    response.delete_cookie(STATE_COOKIE, path="/auth")
    return response


@router.get("/login")
async def login():
    if not _owners():
        return _frontend("error", "owner_not_configured")
    nonce = secrets.token_urlsafe(24)
    params = {
        "client_id": settings.CLIENT_ID,
        "response_type": "code",
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
        "response_mode": "query",
        "scope": " ".join(SCOPES),
        "state": _serializer().dumps(nonce),
        "prompt": "select_account",
    }
    response = RedirectResponse(url=f"{auth_urls()['authorize']}?{urlencode(params)}")
    response.set_cookie(STATE_COOKIE, nonce, max_age=STATE_MAX_AGE, httponly=True, path="/auth",
                        secure=settings.GRAPH_REDIRECT_URI.startswith("https://"), samesite="lax")
    return response


@router.get("/callback")
async def callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None,
                   db: Session = Depends(get_db)):
    if error:
        logger.warning("Microsoft sign-in returned an error: %s", error)
        return _frontend("error", error)
    # The state must be ours, recent, and belong to this browser.
    try:
        nonce = _serializer().loads(state or "", max_age=STATE_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return _frontend("error", "invalid_state")
    cookie = request.cookies.get(STATE_COOKIE) or ""
    if not code or not secrets.compare_digest(str(nonce), cookie):
        return _frontend("error", "invalid_state")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            tok = await client.post(auth_urls()["token"], data={
                "client_id": settings.CLIENT_ID,
                "client_secret": settings.CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.GRAPH_REDIRECT_URI,
                "scope": " ".join(SCOPES),
            })
            if tok.status_code >= 300:
                logger.error("Token exchange failed: HTTP %s", tok.status_code)
                return _frontend("error", "token_exchange_failed")
            tokens = tok.json()
            me = await client.get("https://graph.microsoft.com/v1.0/me",
                                  params={"$select": "mail,userPrincipalName"},
                                  headers={"Authorization": f"Bearer {tokens['access_token']}"})
            if me.status_code >= 300:
                return _frontend("error", "could_not_confirm_account")
            profile = me.json()
    except (httpx.HTTPError, KeyError, ValueError) as e:
        logger.error("Sign-in failed: %s", type(e).__name__)
        return _frontend("error", "auth_failed")

    who = {str(profile.get("mail") or "").lower(), str(profile.get("userPrincipalName") or "").lower()} - {""}
    if not who & _owners():
        logger.warning("Refused sign-in from an account that is not the owner")
        return _frontend("error", "wrong_account")

    if not await token_manager.store_tokens(db, "tom", tokens):
        return _frontend("error", "token_storage_failed")
    return _frontend("success")


@router.get("/token", dependencies=[Depends(require_access_key)])
async def token_status(db: Session = Depends(get_db)):
    """Whether Aimelia is connected to Microsoft 365. Never returns the token itself."""
    from .models import UserToken

    connected = await token_manager.get_valid_access_token(db, "tom") is not None
    record = db.query(UserToken).filter(UserToken.user_id == "tom").first()
    return {"status": "ok" if connected else "error", "has_token": connected,
            "expires_at": record.expires_at.isoformat() if connected and record else None,
            **({} if connected else {"message": "Not connected to Microsoft 365. Sign in again."})}


@router.get("/debug", dependencies=[Depends(require_access_key)])
async def debug_auth(db: Session = Depends(get_db)):
    """Configuration check with no secrets in it."""
    from .models import UserToken

    record = db.query(UserToken).filter(UserToken.user_id == "tom").first()
    return {"status": "ok", "debug": {
        "encryption_key_set": bool(settings.ENCRYPTION_KEY),
        "encryption_available": token_manager.fernet is not None,
        "owner_email_set": bool(_owners()),
        "client_secret_set": bool(settings.CLIENT_SECRET),
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
        "stored_tokens": record is not None,
        "token_expires_at": record.expires_at.isoformat() if record else None,
    }}


@router.post("/revoke", dependencies=[Depends(require_access_key)])
async def revoke_tokens(db: Session = Depends(get_db)):
    """Disconnect Microsoft 365: delete the stored tokens."""
    success = await token_manager.revoke_tokens(db, "tom")
    return {"status": "ok" if success else "error",
            "message": "Tokens revoked" if success else "Failed to revoke tokens"}
