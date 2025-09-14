"""
Minimal authentication for testing - reduced permissions
"""
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

# Minimal scopes for testing - no admin approval needed
MINIMAL_SCOPES = [
    "offline_access",
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/Mail.Read",  # Read only
    "https://graph.microsoft.com/Calendars.Read",  # Read only
]

@router.get("/login")
async def login():
    from urllib.parse import urlencode
    params = {
        "client_id": settings.CLIENT_ID,
        "response_type": "code",
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
        "scope": " ".join(MINIMAL_SCOPES),
        "state": "aimelia"
    }
    auth_url = f"{auth_urls()['authorize']}?{urlencode(params)}"
    return RedirectResponse(url=auth_url)

@router.get("/callback")
async def callback(request: Request, code: str | None = None, error: str | None = None, error_description: str | None = None, db: Session = Depends(get_db)):
    if error:
        error_messages = {
            "access_denied": "User declined to consent to access the app. Please try again and accept the permissions.",
            "invalid_request": "Invalid request. Please try logging in again.",
            "unauthorized_client": "The application is not authorized to request an access token.",
            "unsupported_response_type": "The authorization server does not support this response type.",
            "invalid_scope": "The requested scope is invalid, unknown, or malformed.",
            "server_error": "The authorization server encountered an unexpected condition.",
            "temporarily_unavailable": "The authorization server is temporarily unavailable."
        }
        user_message = error_messages.get(error, f"Authentication error: {error}")
        if error_description:
            user_message += f" Details: {error_description}"
        return {"error": error, "error_description": error_description, "message": user_message, "status": "error"}
    
    if not code:
        return {"error": "no_code", "message": "No authorization code received. Please try logging in again."}
    
    try:
        # Exchange code for tokens
        token_data = {
            "client_id": settings.CLIENT_ID,
            "client_secret": settings.CLIENT_SECRET,
            "code": code,
            "redirect_uri": settings.GRAPH_REDIRECT_URI,
            "grant_type": "authorization_code",
            "scope": " ".join(MINIMAL_SCOPES)
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(auth_urls()["token"], data=token_data)
            response.raise_for_status()
            tokens = response.json()
        
        # Store tokens
        await token_manager.store_tokens(db, "tom", tokens["access_token"], tokens.get("refresh_token"))
        
        return {
            "status": "success",
            "message": "Authentication successful! You can now use Aimelia with limited permissions.",
            "permissions": "Read-only access to mail and calendar",
            "note": "For full functionality, admin approval is required for write permissions."
        }
        
    except Exception as e:
        return {"error": "token_exchange_failed", "message": f"Failed to exchange code for tokens: {str(e)}"}

@router.get("/token")
async def get_token(db: Session = Depends(get_db)):
    """Get current access token."""
    access_token = await token_manager.get_valid_access_token(db, "tom")
    if not access_token:
        return {"error": "no_token", "message": "No valid access token available. Please log in again."}
    
    return {"access_token": access_token, "status": "success"}

@router.post("/revoke")
async def revoke_tokens(db: Session = Depends(get_db)):
    """Revoke stored tokens."""
    await token_manager.revoke_tokens(db, "tom")
    return {"message": "Tokens revoked successfully", "status": "success"}
