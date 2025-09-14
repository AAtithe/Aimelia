"""
Database setup and migration endpoints
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .db import get_db, engine, Base
from .models import UserToken, KnowledgeChunk
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/setup/migrate")
async def run_migration(db: Session = Depends(get_db)):
    """Run database migration to create all tables."""
    try:
        logger.info("Starting database migration...")
        
        # Create all tables
        Base.metadata.create_all(bind=engine)
        
        logger.info("✅ Database migration completed successfully!")
        
        return {
            "success": True,
            "message": "Database migration completed successfully",
            "tables_created": [
                "user_tokens",
                "kb_chunks"
            ]
        }
        
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        raise HTTPException(status_code=500, detail=f"Migration failed: {str(e)}")

@router.get("/setup/status")
async def get_setup_status(db: Session = Depends(get_db)):
    """Check database setup status."""
    try:
        # Check if UserToken table exists by trying to query it
        token_count = db.query(UserToken).count()
        
        # Check if KnowledgeChunk table exists
        chunk_count = db.query(KnowledgeChunk).count()
        
        return {
            "success": True,
            "database_status": "ready",
            "tables": {
                "user_tokens": {
                    "exists": True,
                    "record_count": token_count
                },
                "kb_chunks": {
                    "exists": True,
                    "record_count": chunk_count
                }
            },
            "message": "Database is properly set up"
        }
        
    except Exception as e:
        return {
            "success": False,
            "database_status": "needs_migration",
            "error": str(e),
            "message": "Database needs migration. Run /setup/migrate endpoint."
        }

@router.post("/setup/test-token-storage")
async def test_token_storage(db: Session = Depends(get_db)):
    """Test token storage functionality."""
    try:
        from .token_manager import token_manager
        
        # Test with dummy tokens
        test_tokens = {
            "access_token": "test_access_token_12345",
            "refresh_token": "test_refresh_token_67890",
            "expires_in": 3600
        }
        
        # Try to store test tokens
        success = await token_manager.store_tokens(db, "test_user", test_tokens)
        
        if success:
            # Clean up test tokens
            db.query(UserToken).filter(UserToken.user_id == "test_user").delete()
            db.commit()
            
            return {
                "success": True,
                "message": "Token storage test passed",
                "encryption_enabled": token_manager.fernet is not None
            }
        else:
            return {
                "success": False,
                "message": "Token storage test failed"
            }
            
    except Exception as e:
        return {
            "success": False,
            "message": f"Token storage test failed: {str(e)}"
        }
