#!/usr/bin/env python3
"""
Database migration script to create the UserToken table.
Run this after setting up your environment variables.
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db import engine, Base
from app.models import UserToken
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate():
    """Create all tables including the new UserToken table."""
    try:
        logger.info("Creating database tables...")
        Base.metadata.create_all(bind=engine)
        logger.info("✅ Database migration completed successfully!")
        logger.info("UserToken table created for secure token storage.")
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    migrate()
