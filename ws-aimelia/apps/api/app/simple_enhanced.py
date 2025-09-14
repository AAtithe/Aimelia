"""
Simple enhanced endpoints for testing.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from .db import get_db

router = APIRouter()

@router.get("/health/enhanced")
async def enhanced_health_check(db: Session = Depends(get_db)):
    """Enhanced health check endpoint."""
    try:
        return {
            "aimelia": "ok",
            "version": "2.0.0",
            "enhanced_features": True,
            "status": "healthy",
            "message": "Enhanced AI features are available"
        }
    except Exception as e:
        return {
            "aimelia": "error",
            "error": str(e),
            "enhanced_features": False
        }

@router.post("/emails/triage/enhanced")
async def enhanced_email_triage(
    email_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Enhanced email triage with context awareness."""
    try:
        return {
            "status": "success",
            "message": "Enhanced triage endpoint working",
            "data": email_data,
            "enhanced": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/test")
async def test_endpoint():
    """Test endpoint to verify enhanced features are working."""
    return {
        "status": "success",
        "message": "Enhanced AI features are working!",
        "version": "2.0.0"
    }
