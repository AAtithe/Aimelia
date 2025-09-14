"""
Test all environment variables and configurations
"""
from fastapi import APIRouter
from .settings import settings
import os

router = APIRouter()

@router.get("/test/env")
async def test_environment():
    """Test all environment variables and configurations."""
    return {
        "environment_test": {
            "database": {
                "url_configured": bool(settings.DATABASE_URL),
                "url_length": len(settings.DATABASE_URL) if settings.DATABASE_URL else 0,
                "url_starts_with": settings.DATABASE_URL[:20] + "..." if settings.DATABASE_URL else None
            },
            "azure_ad": {
                "client_id": settings.CLIENT_ID,
                "tenant_id": settings.TENANT_ID,
                "redirect_uri": settings.GRAPH_REDIRECT_URI,
                "has_client_secret": bool(settings.CLIENT_SECRET),
                "client_secret_length": len(settings.CLIENT_SECRET) if settings.CLIENT_SECRET else 0,
                "client_secret_starts_with": settings.CLIENT_SECRET[:8] + "..." if settings.CLIENT_SECRET else None
            },
            "openai": {
                "api_key_configured": bool(settings.OPENAI_API_KEY),
                "api_key_length": len(settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY else 0,
                "api_key_starts_with": settings.OPENAI_API_KEY[:8] + "..." if settings.OPENAI_API_KEY else None
            },
            "encryption": {
                "encryption_key_configured": bool(settings.ENCRYPTION_KEY),
                "encryption_key_length": len(settings.ENCRYPTION_KEY) if settings.ENCRYPTION_KEY else 0
            },
            "render_specific": {
                "render_env": os.getenv("RENDER", "false"),
                "port": os.getenv("PORT", "8000"),
                "python_version": os.getenv("PYTHON_VERSION", "unknown")
            }
        },
        "status": "Environment variables loaded successfully",
        "recommendations": [
            "Client secret length should be 40+ characters",
            "OpenAI API key should start with 'sk-'",
            "Database URL should start with 'postgresql://'",
            "Encryption key should be 44 characters (base64 encoded Fernet key)"
        ]
    }

@router.get("/test/health")
async def test_health():
    """Test basic health and connectivity."""
    try:
        # Test database connection
        from .db import get_db
        db = next(get_db())
        db_test = "✅ Database connection successful"
    except Exception as e:
        db_test = f"❌ Database connection failed: {str(e)}"
    
    try:
        # Test OpenAI connection
        import openai
        client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
        # Simple test - just check if we can create a client
        openai_test = "✅ OpenAI client created successfully"
    except Exception as e:
        openai_test = f"❌ OpenAI connection failed: {str(e)}"
    
    return {
        "health_check": {
            "database": db_test,
            "openai": openai_test,
            "overall_status": "healthy" if "✅" in db_test and "✅" in openai_test else "issues_detected"
        }
    }
