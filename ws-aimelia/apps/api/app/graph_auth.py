import httpx, base64, os
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from .settings import settings

router = APIRouter(prefix="/auth", tags=["auth"])

auth_base = "https://login.microsoftonline.com"

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

@router.get("/login")
async def login():
    from urllib.parse import urlencode
    params = {
        "client_id": settings.CLIENT_ID,
        "response_type": "code",
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
        "response_mode": "query",
        "scope": " ".join(SCOPES),
        "state": "aimelia",
    }
    return RedirectResponse(url=f"{auth_urls()['authorize']}?{urlencode(params)}")

@router.get("/callback")
async def callback(request: Request, code: str | None = None):
    if not code:
        return {"error": "no_code"}
    data = {
        "client_id": settings.CLIENT_ID,
        "client_secret": settings.CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
    }
    async with httpx.AsyncClient() as client:
        tok = await client.post(auth_urls()["token"], data=data)
        tok.raise_for_status()
        tokens = tok.json()
    # TODO: persist tokens per-user (encrypted) in DB
    return {"status": "ok", "tokens_saved": bool(tokens)}