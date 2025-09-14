"""
Auth switching utility for testing
"""
from fastapi import APIRouter
from .settings import settings

router = APIRouter()

@router.get("/auth/info")
async def get_auth_info():
    """Get information about current auth configuration."""
    return {
        "client_id": settings.CLIENT_ID,
        "tenant_id": settings.TENANT_ID,
        "redirect_uri": settings.GRAPH_REDIRECT_URI,
        "note": "For testing without admin approval, use minimal auth endpoints",
        "minimal_auth_url": f"{settings.GRAPH_REDIRECT_URI.replace('/callback', '/minimal-login')}",
        "full_auth_url": f"{settings.GRAPH_REDIRECT_URI.replace('/callback', '/login')}"
    }
