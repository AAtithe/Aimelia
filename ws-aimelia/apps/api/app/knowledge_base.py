"""
Knowledge Base with pgvector for RAG (Retrieval-Augmented Generation)
Stores and retrieves contextual information for Aimelia's responses.
"""
import os
from typing import List, Dict, Optional
from sqlalchemy import text, Column, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func as sql_func
import uuid
from datetime import datetime
from .db import Base, get_db
# Removed circular import - ai_service will be imported when needed
import logging

logger = logging.getLogger(__name__)

class KnowledgeChunk(Base):
    """Knowledge base chunks with vector embeddings."""
    __tablename__ = "kb_chunks"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source = Column(String, nullable=False)  # 'email', 'meeting', 'document', 'policy'
    source_id = Column(String, nullable=True)  # email_id, meeting_id, doc_id
    title = Column(String, nullable=False)
    chunk = Column(Text, nullable=False)
    embedding = Column(String, nullable=True)  # JSON string of embedding vector
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class KnowledgeRetriever:
    """Handles knowledge base operations and retrieval."""
    
    def __init__(self):
        self.embedding_model = "text-embedding-3-large"
        self.embedding_dimension = 3072  # text-embedding-3-large dimension
    
    async def embed_text(self, text: str) -> List[float]:
        """Generate embedding for text using OpenAI."""
        try:
            # Import ai_service here to avoid circular import
            from .ai_service import ai_service
            
            if not ai_service.client:
                logger.error("OpenAI client not available")
                return []
                
            response = await ai_service.client.embeddings.create(
                model=self.embedding_model,
                input=text
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"Error generating embedding: {e}")
            return []
    
    async def store_chunk(self, db, source: str, source_id: str, title: str, 
                         chunk: str) -> bool:
        """Store a knowledge chunk with embedding."""
        try:
            # Generate embedding
            embedding = await self.embed_text(chunk)
            if not embedding:
                return False
            
            # Store in database
            kb_chunk = KnowledgeChunk(
                source=source,
                source_id=source_id,
                title=title,
                chunk=chunk,
                embedding=str(embedding)  # Store as JSON string
            )
            
            db.add(kb_chunk)
            db.commit()
            logger.info(f"Stored knowledge chunk: {title}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing knowledge chunk: {e}")
            db.rollback()
            return False
    
    async def retrieve_chunks(self, db, query: str, top_k: int = 6, 
                            source_filter: Optional[str] = None) -> List[Dict]:
        """Retrieve relevant knowledge chunks using vector similarity."""
        try:
            # Generate query embedding
            query_embedding = await self.embed_text(query)
            if not query_embedding:
                return []
            
            # Build SQL query for vector similarity search
            sql = text("""
                SELECT id, source, source_id, title, chunk, 
                       (embedding::vector <-> :query_vec) as distance
                FROM kb_chunks
                WHERE (:source_filter IS NULL OR source = :source_filter)
                ORDER BY embedding::vector <-> :query_vec
                LIMIT :top_k
            """)
            
            result = db.execute(sql, {
                "query_vec": str(query_embedding),
                "source_filter": source_filter,
                "top_k": top_k
            }).fetchall()
            
            chunks = []
            for row in result:
                chunks.append({
                    "id": str(row.id),
                    "source": row.source,
                    "source_id": row.source_id,
                    "title": row.title,
                    "chunk": row.chunk,
                    "distance": float(row.distance)
                })
            
            logger.info(f"Retrieved {len(chunks)} knowledge chunks for query: {query[:50]}...")
            return chunks
            
        except Exception as e:
            logger.error(f"Error retrieving knowledge chunks: {e}")
            return []
    
    async def index_email(self, db, email_id: str, subject: str, 
                         body: str, sender: str) -> bool:
        """Index an email for knowledge retrieval."""
        # Split email into chunks (simple approach)
        chunks = self._split_text_into_chunks(body, max_chunk_size=1000)
        
        success_count = 0
        for i, chunk in enumerate(chunks):
            title = f"Email: {subject} (Part {i+1})"
            if await self.store_chunk(db, "email", email_id, title, chunk):
                success_count += 1
        
        logger.info(f"Indexed email {email_id}: {success_count}/{len(chunks)} chunks")
        return success_count > 0
    
    async def index_meeting(self, db, meeting_id: str, title: str, 
                           notes: str, attendees: List[str]) -> bool:
        """Index meeting notes for knowledge retrieval."""
        # Create context-rich content
        context = f"Meeting: {title}\nAttendees: {', '.join(attendees)}\n\n{notes}"
        chunks = self._split_text_into_chunks(context, max_chunk_size=1000)
        
        success_count = 0
        for i, chunk in enumerate(chunks):
            chunk_title = f"Meeting: {title} (Part {i+1})"
            if await self.store_chunk(db, "meeting", meeting_id, chunk_title, chunk):
                success_count += 1
        
        logger.info(f"Indexed meeting {meeting_id}: {success_count}/{len(chunks)} chunks")
        return success_count > 0
    
    def _split_text_into_chunks(self, text: str, max_chunk_size: int = 1000) -> List[str]:
        """Split text into overlapping chunks for better retrieval."""
        words = text.split()
        chunks = []
        
        for i in range(0, len(words), max_chunk_size - 100):  # 100 word overlap
            chunk = ' '.join(words[i:i + max_chunk_size])
            if chunk.strip():
                chunks.append(chunk)
        
        return chunks

# Global instance
knowledge_retriever = KnowledgeRetriever()
