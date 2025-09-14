"""
Debug authentication configuration
"""
from fastapi import APIRouter
from .settings import settings

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
