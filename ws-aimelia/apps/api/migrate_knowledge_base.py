#!/usr/bin/env python3
"""
Database migration for knowledge base with pgvector support.
This script sets up the knowledge base tables and enables pgvector extension.
"""
import os
import sys
from pathlib import Path

# Add the app directory to Python path
sys.path.append(str(Path(__file__).parent / "app"))

from app.db import engine, Base
from app.models import KnowledgeChunk
from sqlalchemy import text
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def enable_pgvector():
    """Enable pgvector extension in PostgreSQL."""
    try:
        with engine.connect() as conn:
            # Enable pgvector extension
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            conn.commit()
            logger.info("✅ pgvector extension enabled")
    except Exception as e:
        logger.error(f"❌ Failed to enable pgvector: {e}")
        return False
    return True

def create_knowledge_base_table():
    """Create the knowledge base table."""
    try:
        # Create the table
        KnowledgeChunk.__table__.create(engine, checkfirst=True)
        logger.info("✅ Knowledge base table created")
        
        # Add vector column if it doesn't exist
        with engine.connect() as conn:
            # Check if vector column exists
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'kb_chunks' 
                AND column_name = 'embedding_vector'
            """))
            
            if not result.fetchone():
                # Add vector column
                conn.execute(text("""
                    ALTER TABLE kb_chunks 
                    ADD COLUMN embedding_vector vector(3072);
                """))
                conn.commit()
                logger.info("✅ Vector column added to knowledge base table")
            else:
                logger.info("✅ Vector column already exists")
        
        return True
    except Exception as e:
        logger.error(f"❌ Failed to create knowledge base table: {e}")
        return False

def create_vector_index():
    """Create vector similarity index for fast retrieval."""
    try:
        with engine.connect() as conn:
            # Create HNSW index for vector similarity search
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx 
                ON kb_chunks 
                USING hnsw (embedding_vector vector_cosine_ops);
            """))
            conn.commit()
            logger.info("✅ Vector similarity index created")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to create vector index: {e}")
        return False

def seed_initial_knowledge():
    """Seed the knowledge base with initial WS context."""
    try:
        from app.db import SessionLocal
        from app.knowledge_base import knowledge_retriever
        
        db = SessionLocal()
        
        # Initial knowledge chunks about WS
        initial_chunks = [
            {
                "source": "policy",
                "source_id": "ws_mission",
                "title": "Williams Stanley Mission",
                "chunk": "Williams, Stanley & Co is a leading hospitality accounting firm specializing in payroll, tax compliance, tronc management, and financial planning for hospitality groups. We help hospitality businesses navigate complex regulations while optimizing their financial performance."
            },
            {
                "source": "policy",
                "source_id": "ws_products",
                "title": "WS Products Overview",
                "chunk": "Key products: Teampay (payroll management system), Troncmaster (tronc distribution platform), WS Insights (financial analytics and reporting). These tools help hospitality clients manage their workforce, comply with regulations, and make data-driven decisions."
            },
            {
                "source": "policy",
                "source_id": "vat_guidance",
                "title": "VAT Compliance Guidelines",
                "chunk": "VAT compliance is critical for hospitality businesses. Key considerations: standard rate (20%) for most food and drink, reduced rate (5%) for certain items, zero rate for some takeaway food. Always verify VAT treatment with HMRC guidelines and maintain detailed records."
            },
            {
                "source": "policy",
                "source_id": "tronc_rules",
                "title": "Tronc Distribution Rules",
                "chunk": "Tronc (service charge) distribution must comply with HMRC rules. Key points: tronc must be distributed fairly among staff, cannot be used to top up minimum wage, must be managed by independent tronc committee, and requires proper record keeping for tax purposes."
            },
            {
                "source": "policy",
                "source_id": "payroll_best_practices",
                "title": "Payroll Best Practices",
                "chunk": "Payroll best practices for hospitality: ensure accurate timesheet recording, implement proper overtime calculations, maintain detailed records for HMRC compliance, use automated systems like Teampay for accuracy, and regularly review payroll costs and trends."
            }
        ]
        
        success_count = 0
        for chunk_data in initial_chunks:
            if knowledge_retriever.store_chunk(
                db, 
                chunk_data["source"], 
                chunk_data["source_id"], 
                chunk_data["title"], 
                chunk_data["chunk"]
            ):
                success_count += 1
        
        db.close()
        logger.info(f"✅ Seeded {success_count}/{len(initial_chunks)} initial knowledge chunks")
        return success_count > 0
        
    except Exception as e:
        logger.error(f"❌ Failed to seed initial knowledge: {e}")
        return False

async def main():
    """Run the complete migration."""
    logger.info("🚀 Starting knowledge base migration...")
    
    # Step 1: Enable pgvector
    if not enable_pgvector():
        logger.error("Failed to enable pgvector. Please install pgvector extension.")
        return False
    
    # Step 2: Create knowledge base table
    if not create_knowledge_base_table():
        logger.error("Failed to create knowledge base table.")
        return False
    
    # Step 3: Create vector index
    if not create_vector_index():
        logger.error("Failed to create vector index.")
        return False
    
    # Step 4: Seed initial knowledge
    if not seed_initial_knowledge():
        logger.error("Failed to seed initial knowledge.")
        return False
    
    logger.info("🎉 Knowledge base migration completed successfully!")
    return True

if __name__ == "__main__":
    main()
