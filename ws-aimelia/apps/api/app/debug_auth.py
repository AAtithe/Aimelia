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

@router.post("/debug/clear-tokens")
async def clear_tokens(db: Session = Depends(get_db)):
    """Clear all stored tokens to force re-authentication."""
    try:
        from .models import UserToken
        
        # Delete all tokens for user 'tom'
        deleted_count = db.query(UserToken).filter(UserToken.user_id == "tom").delete()
        db.commit()
        
        return {
            "status": "ok",
            "message": f"Cleared {deleted_count} token records for user 'tom'",
            "tokens_deleted": deleted_count
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to clear tokens: {str(e)}"
        }

@router.post("/debug/test-token-storage")
async def test_token_storage(db: Session = Depends(get_db)):
    """Test token storage with dummy data."""
    try:
        from .token_manager import token_manager
        
        # Create dummy tokens
        dummy_tokens = {
            "access_token": "test_access_token_12345",
            "refresh_token": "test_refresh_token_67890",
            "expires_in": 3600
        }
        
        # Try to store them
        success = await token_manager.store_tokens(db, "test_user", dummy_tokens)
        
        return {
            "status": "ok" if success else "error",
            "storage_success": success,
            "message": "Token storage test completed"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Token storage test failed: {str(e)}"
        }

@router.get("/debug/check-token")
async def check_token_details(db: Session = Depends(get_db)):
    """Check detailed token information."""
    try:
        from .models import UserToken
        from datetime import datetime
        
        token_record = db.query(UserToken).filter(UserToken.user_id == "tom").first()
        if not token_record:
            return {"status": "error", "message": "No token found"}
        
        current_time = datetime.utcnow()
        is_expired = token_record.expires_at < current_time
        
        return {
            "status": "ok",
            "user_id": token_record.user_id,
            "expires_at": token_record.expires_at.isoformat(),
            "current_time": current_time.isoformat(),
            "is_expired": is_expired,
            "has_access_token": bool(token_record.encrypted_access_token),
            "has_refresh_token": bool(token_record.encrypted_refresh_token),
            "access_token_length": len(token_record.encrypted_access_token) if token_record.encrypted_access_token else 0,
            "refresh_token_length": len(token_record.encrypted_refresh_token) if token_record.encrypted_refresh_token else 0
        }
    except Exception as e:
        return {"status": "error", "message": f"Failed to check token: {str(e)}"}
