import httpx, base64, os, logging
from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse, HTMLResponse
from sqlalchemy.orm import Session
from .settings import settings
from .db import get_db
from .token_manager import token_manager

logger = logging.getLogger(__name__)

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
async def callback(request: Request, code: str | None = None, error: str | None = None, error_description: str | None = None, db: Session = Depends(get_db)):
    # Enhanced logging for debugging
    logger.info(f"=== AUTH CALLBACK DEBUG ===")
    logger.info(f"Code present: {code is not None}")
    logger.info(f"Error: {error}")
    logger.info(f"Error description: {error_description}")
    logger.info(f"Full request URL: {request.url}")
    logger.info(f"Query params: {dict(request.query_params)}")
    logger.info(f"Headers: {dict(request.headers)}")
    
    # Handle authentication errors
    if error:
        error_messages = {
            "access_denied": "User declined to consent to access the app. Please try again and accept the permissions.",
            "invalid_request": "Invalid authentication request. Please try again.",
            "unauthorized_client": "Client authentication failed. Please contact support.",
            "unsupported_response_type": "Unsupported response type. Please contact support.",
            "invalid_scope": "Invalid scope requested. Please contact support.",
            "server_error": "Authentication server error. Please try again later.",
            "temporarily_unavailable": "Authentication service temporarily unavailable. Please try again later."
        }
        
        user_message = error_messages.get(error, f"Authentication error: {error}")
        if error_description:
            user_message += f" Details: {error_description}"
        
        return {
            "error": error,
            "error_description": error_description,
            "message": user_message,
            "status": "error"
        }
    
    if not code:
        return {"error": "no_code", "message": "No authorization code received. Please try logging in again."}
    
    data = {
        "client_id": settings.CLIENT_ID,
        "client_secret": settings.CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
        "scope": " ".join(SCOPES),
    }
    
    try:
        async with httpx.AsyncClient() as client:
            tok = await client.post(auth_urls()["token"], data=data)
            
            if tok.status_code == 401:
                error_detail = tok.text
                return {
                    "error": "unauthorized",
                    "message": f"Authentication failed: {tok.status_code} {tok.reason_phrase}",
                    "details": error_detail,
                    "debug_info": {
                        "client_id": settings.CLIENT_ID,
                        "redirect_uri": settings.GRAPH_REDIRECT_URI,
                        "scope": " ".join(SCOPES)
                    }
                }
            
            tok.raise_for_status()
            tokens = tok.json()
        
        # Store encrypted tokens in database
        logger.info(f"Attempting to store tokens for user 'tom'")
        logger.info(f"Tokens received: {list(tokens.keys())}")
        
        # Store encrypted tokens in database
        success = await token_manager.store_tokens(db, "tom", tokens)
        logger.info(f"Token storage result: {success}")
        
        if not success:
            logger.error("Token storage failed - this will cause authentication to fail")
        
        if success:
            # Redirect to main page, frontend will detect authentication status
            logger.info("✅ Authentication successful, redirecting to main page")
            return RedirectResponse(url="https://aimelia.vercel.app/?auth=success")
        else:
            logger.error("❌ Token storage failed")
            return RedirectResponse(url="https://aimelia.vercel.app/?auth=error&reason=token_storage_failed")
    except Exception as e:
        logger.error(f"❌ Authentication exception: {str(e)}")
        logger.error(f"Exception type: {type(e).__name__}")
        return RedirectResponse(url=f"https://aimelia.vercel.app/?auth=error&reason=auth_failed&details={str(e)[:100]}")

@router.get("/test-callback")
async def test_callback():
    """Test endpoint to verify callback is working."""
    return {"status": "ok", "message": "Callback endpoint is working"}

@router.get("/token")
async def get_token(db: Session = Depends(get_db)):
    """Get a valid access token for the authenticated user."""
    access_token = await token_manager.get_valid_access_token(db, "tom")
    if access_token:
        return {
            "status": "ok", 
            "has_token": True,
            "access_token": access_token
        }
    else:
        return {"status": "error", "message": "No valid token available. Please re-authenticate.", "has_token": False}

@router.get("/debug")
async def debug_auth(db: Session = Depends(get_db)):
    """Debug authentication system - shows detailed status."""
    try:
        # Check if we have stored tokens
        from .models import UserToken
        token_record = db.query(UserToken).filter(UserToken.user_id == "tom").first()
        
        debug_info = {
            "encryption_available": token_manager.fernet is not None,
            "encryption_key_set": settings.ENCRYPTION_KEY is not None,
            "stored_tokens": token_record is not None,
            "settings_check": {
                "tenant_id": settings.TENANT_ID[:8] + "..." if settings.TENANT_ID else None,
                "client_id": settings.CLIENT_ID[:8] + "..." if settings.CLIENT_ID else None,
                "client_secret_set": bool(settings.CLIENT_SECRET),
                "redirect_uri": settings.GRAPH_REDIRECT_URI
            }
        }
        
        if token_record:
            debug_info["token_expires_at"] = str(token_record.expires_at)
            debug_info["token_created_at"] = str(token_record.created_at)
        
        return {"debug": debug_info, "status": "ok"}
    except Exception as e:
        return {"debug_error": str(e), "status": "error"}

@router.post("/revoke")
async def revoke_tokens(db: Session = Depends(get_db)):
    """Revoke and delete stored tokens."""
    success = await token_manager.revoke_tokens(db, "tom")
    return {
        "status": "ok" if success else "error",
        "message": "Tokens revoked" if success else "Failed to revoke tokens"
    }
