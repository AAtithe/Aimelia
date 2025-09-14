import httpx, base64, os
from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from .settings import settings
from .db import get_db
from .token_manager import token_manager

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
async def callback(request: Request, code: str | None = None, db: Session = Depends(get_db)):
    if not code:
        return {"error": "no_code"}
    
    data = {
        "client_id": settings.CLIENT_ID,
        "client_secret": settings.CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
    }
    
    try:
        async with httpx.AsyncClient() as client:
            tok = await client.post(auth_urls()["token"], data=data)
            tok.raise_for_status()
            tokens = tok.json()
        
        # Store encrypted tokens in database
        success = await token_manager.store_tokens(db, "tom", tokens)
        
        return {
            "status": "ok" if success else "error",
            "tokens_saved": success,
            "message": "Tokens stored securely" if success else "Failed to store tokens"
        }
    except Exception as e:
        return {"status": "error", "message": f"Authentication failed: {str(e)}"}

@router.get("/token")
async def get_token(db: Session = Depends(get_db)):
    """Get a valid access token for the authenticated user."""
    access_token = await token_manager.get_valid_access_token(db, "tom")
    if access_token:
        return {"status": "ok", "has_token": True}
    else:
        return {"status": "error", "message": "No valid token available. Please re-authenticate."}

@router.post("/revoke")
async def revoke_tokens(db: Session = Depends(get_db)):
    """Revoke and delete stored tokens."""
    success = await token_manager.revoke_tokens(db, "tom")
    return {
        "status": "ok" if success else "error",
        "message": "Tokens revoked" if success else "Failed to revoke tokens"
    }