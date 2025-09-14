import httpx, base64, os
from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse, HTMLResponse
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
async def callback(request: Request, code: str | None = None, error: str | None = None, error_description: str | None = None, db: Session = Depends(get_db)):
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
        success = await token_manager.store_tokens(db, "tom", tokens)
        
        if success:
            # Return a beautiful HTML success page
            html_content = """
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Aimelia - Authentication Successful</title>
                <script>
                    // Always redirect to dashboard after successful authentication
                    console.log('Authentication successful, redirecting to dashboard...');
                    
                    // Wait a bit longer to ensure token is stored
                    setTimeout(() => {
                        console.log('Redirecting to dashboard now...');
                        // Force a hard redirect to clear any cached state
                        window.location.replace('https://aimelia.vercel.app/dashboard');
                    }, 3000);
                </script>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        margin: 0;
                        padding: 0;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .container {
                        background: white;
                        border-radius: 20px;
                        box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                        padding: 3rem;
                        text-align: center;
                        max-width: 500px;
                        width: 90%;
                    }
                    .success-icon {
                        width: 80px;
                        height: 80px;
                        background: linear-gradient(135deg, #10b981, #3b82f6);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0 auto 2rem;
                        animation: pulse 2s infinite;
                    }
                    .success-icon svg {
                        width: 40px;
                        height: 40px;
                        color: white;
                    }
                    h1 {
                        color: #1f2937;
                        font-size: 2.5rem;
                        font-weight: 700;
                        margin-bottom: 1rem;
                    }
                    .subtitle {
                        color: #6b7280;
                        font-size: 1.2rem;
                        margin-bottom: 2rem;
                    }
                    .features {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 1rem;
                        margin: 2rem 0;
                    }
                    .feature {
                        background: #f8fafc;
                        border: 1px solid #e2e8f0;
                        border-radius: 12px;
                        padding: 1rem;
                        text-align: center;
                    }
                    .feature-icon {
                        font-size: 2rem;
                        margin-bottom: 0.5rem;
                    }
                    .feature-title {
                        font-weight: 600;
                        color: #374151;
                        margin-bottom: 0.25rem;
                    }
                    .feature-desc {
                        font-size: 0.875rem;
                        color: #6b7280;
                    }
                    .redirect-message {
                        color: #6b7280;
                        margin-top: 2rem;
                        font-size: 0.9rem;
                    }
                    @keyframes pulse {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success-icon">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                    </div>
                    <h1>Welcome to Aimelia!</h1>
                    <p class="subtitle">Your AI-powered personal assistant is now ready</p>
                    
                    <div class="features">
                        <div class="feature">
                            <div class="feature-icon">📧</div>
                            <div class="feature-title">Smart Email Triage</div>
                            <div class="feature-desc">AI-powered processing</div>
                        </div>
                        <div class="feature">
                            <div class="feature-icon">📅</div>
                            <div class="feature-title">Meeting Prep</div>
                            <div class="feature-desc">Star-level briefs</div>
                        </div>
                        <div class="feature">
                            <div class="feature-icon">🤖</div>
                            <div class="feature-title">Background Automation</div>
                            <div class="feature-desc">Always working for you</div>
                        </div>
                        <div class="feature">
                            <div class="feature-icon">🧠</div>
                            <div class="feature-title">AI Intelligence</div>
                            <div class="feature-desc">Context-aware responses</div>
                        </div>
                    </div>
                    
                    <p class="redirect-message">
                        Redirecting to your dashboard...
                    </p>
                </div>
            </body>
            </html>
            """
            return HTMLResponse(content=html_content)
        else:
            return {
                "status": "error",
                "tokens_saved": False,
                "message": "Failed to store tokens"
            }
    except Exception as e:
        return {"status": "error", "message": f"Authentication failed: {str(e)}"}

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
        return {"status": "error", "message": "No valid token available. Please re-authenticate."}

@router.post("/revoke")
async def revoke_tokens(db: Session = Depends(get_db)):
    """Revoke and delete stored tokens."""
    success = await token_manager.revoke_tokens(db, "tom")
    return {
        "status": "ok" if success else "error",
        "message": "Tokens revoked" if success else "Failed to revoke tokens"
    }