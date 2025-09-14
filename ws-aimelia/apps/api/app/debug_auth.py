"""
Debug authentication configuration
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .settings import settings
from .db import get_db

router = APIRouter()

@router.get("/debug/auth-config")
async def debug_auth_config():
    """Debug authentication configuration without exposing secrets."""
    return {
        "client_id": settings.CLIENT_ID,
        "tenant_id": settings.TENANT_ID,
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
        "has_client_secret": bool(settings.CLIENT_SECRET),
        "client_secret_length": len(settings.CLIENT_SECRET) if settings.CLIENT_SECRET else 0,
        "scopes": [
            "offline_access",
            "https://graph.microsoft.com/Mail.ReadWrite",
            "https://graph.microsoft.com/Mail.Send",
            "https://graph.microsoft.com/Calendars.ReadWrite",
            "https://graph.microsoft.com/User.Read",
        ],
        "auth_url": f"https://login.microsoftonline.com/{settings.TENANT_ID}/oauth2/v2.0/authorize",
        "token_url": f"https://login.microsoftonline.com/{settings.TENANT_ID}/oauth2/v2.0/token",
        "common_issues": [
            "Client secret might be incorrect or expired",
            "Redirect URI must match exactly in Azure AD app registration",
            "Admin consent might not be properly granted",
            "App might be disabled in Azure AD",
            "Client ID might be incorrect"
        ]
    }

@router.get("/debug/token-status")
async def debug_token_status(db: Session = Depends(get_db)):
    """Debug endpoint to check token status in database."""
    try:
        from .models import UserToken
        from datetime import datetime
        
        token_record = db.query(UserToken).filter(UserToken.user_id == "tom").first()
        if not token_record:
            return {
                "status": "error",
                "message": "No token record found for user 'tom'",
                "token_exists": False
            }
        
        current_time = datetime.utcnow()
        is_expired = token_record.expires_at < current_time
        
        return {
            "status": "ok",
            "token_exists": True,
            "expires_at": token_record.expires_at.isoformat(),
            "current_time": current_time.isoformat(),
            "is_expired": is_expired,
            "time_until_expiry": (token_record.expires_at - current_time).total_seconds() if not is_expired else 0,
            "has_access_token": bool(token_record.encrypted_access_token),
            "has_refresh_token": bool(token_record.encrypted_refresh_token)
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to check token status: {str(e)}"
        }
