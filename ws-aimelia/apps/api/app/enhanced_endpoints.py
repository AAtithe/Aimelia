"""
Enhanced API endpoints with context-aware AI features.
Provides intelligent email triage, meeting briefs, and content generation.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from .db import get_db
from .ai_service import ai_service
from .knowledge_base import knowledge_retriever
from .context_builder import context_builder
from .models import Email, Meeting, KnowledgeChunk
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/emails/triage/enhanced")
async def enhanced_email_triage(
    email_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Enhanced email triage with context awareness and knowledge base.
    """
    try:
        subject = email_data.get("subject", "")
        sender = email_data.get("sender", "")
        body = email_data.get("body", "")
        
        # Get client context if available
        client_context = email_data.get("client_context", {})
        
        # Perform context-aware triage
        triage_result = await ai_service.triage_email_with_context(
            subject, sender, body, client_context
        )
        
        # Index the email for future knowledge retrieval
        if email_data.get("email_id"):
            await knowledge_retriever.index_email(
                db, 
                email_data["email_id"], 
                subject, 
                body, 
                sender
            )
        
        return {
            "status": "success",
            "triage": triage_result,
            "context_used": True
        }
        
    except Exception as e:
        logger.error(f"Enhanced email triage failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/emails/drafts/enhanced")
async def enhanced_email_draft(
    email_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Generate context-aware email drafts with persona and knowledge base.
    """
    try:
        original_email = email_data.get("original_email", {})
        context = email_data.get("context", "")
        
        # Generate context-aware response
        draft = await ai_service.generate_email_response(original_email, context)
        
        return {
            "status": "success",
            "draft": draft,
            "context_used": True,
            "persona_applied": True
        }
        
    except Exception as e:
        logger.error(f"Enhanced email draft failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/calendar/briefs/enhanced")
async def enhanced_meeting_brief(
    event_data: Dict[str, Any],
    recent_emails: List[Dict[str, Any]] = [],
    db: Session = Depends(get_db)
):
    """
    Generate context-aware meeting briefs with persona and knowledge base.
    """
    try:
        event = event_data.get("event", {})
        
        # Generate context-aware brief
        brief = await ai_service.generate_context_aware_brief(event, recent_emails)
        
        # Index meeting for future knowledge retrieval
        if event.get("id"):
            attendees = [a.get("emailAddress", {}).get("address", "") for a in event.get("attendees", [])]
            notes = event.get("body", {}).get("content", "")
            
            await knowledge_retriever.index_meeting(
                db,
                event["id"],
                event.get("subject", "Meeting"),
                notes,
                attendees
            )
        
        return {
            "status": "success",
            "brief": brief,
            "context_used": True,
            "persona_applied": True
        }
        
    except Exception as e:
        logger.error(f"Enhanced meeting brief failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/knowledge/index")
async def index_knowledge(
    knowledge_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Index new knowledge into the knowledge base.
    """
    try:
        source = knowledge_data.get("source", "manual")
        source_id = knowledge_data.get("source_id")
        title = knowledge_data.get("title", "")
        content = knowledge_data.get("content", "")
        
        success = await knowledge_retriever.store_chunk(
            db, source, source_id, title, content
        )
        
        if success:
            return {"status": "success", "message": "Knowledge indexed successfully"}
        else:
            raise HTTPException(status_code=500, detail="Failed to index knowledge")
            
    except Exception as e:
        logger.error(f"Knowledge indexing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/knowledge/search")
async def search_knowledge(
    query: str,
    top_k: int = 6,
    source_filter: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Search the knowledge base for relevant information.
    """
    try:
        chunks = await knowledge_retriever.retrieve_chunks(
            db, query, top_k, source_filter
        )
        
        return {
            "status": "success",
            "query": query,
            "results": chunks,
            "count": len(chunks)
        }
        
    except Exception as e:
        logger.error(f"Knowledge search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ai/context-aware-generation")
async def context_aware_generation(
    request_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Generic context-aware AI generation endpoint.
    """
    try:
        task = request_data.get("task", "general")
        meta = request_data.get("meta", {})
        query = request_data.get("query", "")
        top_k = request_data.get("top_k", 6)
        
        # Build context
        messages = await context_builder.build_context(task, meta, query, top_k)
        
        # Generate response
        response = await ai_service.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.3,
            max_tokens=800
        )
        
        result = response.choices[0].message.content
        
        return {
            "status": "success",
            "task": task,
            "result": result,
            "context_used": True,
            "persona_applied": True
        }
        
    except Exception as e:
        logger.error(f"Context-aware generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ai/persona")
async def get_persona():
    """
    Get the current persona profile.
    """
    try:
        persona = context_builder.load_persona()
        return {
            "status": "success",
            "persona": persona
        }
    except Exception as e:
        logger.error(f"Failed to load persona: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ai/fewshots/add")
async def add_fewshot_example(
    example_data: Dict[str, Any]
):
    """
    Add a new few-shot example.
    """
    try:
        task = example_data.get("task", "")
        user_input = example_data.get("user_input", "")
        assistant_output = example_data.get("assistant_output", "")
        
        success = context_builder.fewshot_manager.add_example(
            task, user_input, assistant_output
        )
        
        if success:
            return {"status": "success", "message": "Few-shot example added"}
        else:
            raise HTTPException(status_code=500, detail="Failed to add example")
            
    except Exception as e:
        logger.error(f"Failed to add few-shot example: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health/enhanced")
async def enhanced_health_check(db: Session = Depends(get_db)):
    """
    Enhanced health check including AI and knowledge base status.
    """
    try:
        # Basic health
        basic_health = {"aimelia": "ok"}
        
        # AI service status
        ai_status = {
            "enabled": ai_service.enabled,
            "model": "gpt-4o-mini" if ai_service.enabled else None
        }
        
        # Knowledge base status
        kb_count = db.query(KnowledgeChunk).count()
        kb_status = {
            "chunks_count": kb_count,
            "status": "healthy" if kb_count > 0 else "empty"
        }
        
        # Persona status
        persona_status = {
            "loaded": True,
            "path": str(context_builder.persona_path)
        }
        
        return {
            **basic_health,
            "ai_service": ai_status,
            "knowledge_base": kb_status,
            "persona": persona_status,
            "enhanced_features": True
        }
        
    except Exception as e:
        logger.error(f"Enhanced health check failed: {e}")
        return {
            "aimelia": "error",
            "error": str(e),
            "enhanced_features": False
        }
