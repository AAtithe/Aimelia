"""
API endpoints for smart email drafting functionality.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
from .db import get_db
from .smart_drafting import smart_drafting
from .token_manager import token_manager
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/draft/smart-reply")
async def draft_smart_reply(
    request_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Draft a smart reply to an email using Tom Stanley's tone.
    
    Request body:
    {
        "email_id": "string",
        "thread_summary": "string",
        "subject": "string"
    }
    """
    try:
        email_id = request_data.get("email_id")
        thread_summary = request_data.get("thread_summary", "")
        subject = request_data.get("subject", "")
        
        if not email_id:
            raise HTTPException(status_code=400, detail="email_id is required")
        
        result = await smart_drafting.draft_smart_reply(
            email_id, thread_summary, subject, db
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Error in draft_smart_reply endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/draft/auto-process")
async def auto_process_email(
    request_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Automatically process an incoming email and create a smart draft.
    
    Request body:
    {
        "email_id": "string"
    }
    """
    try:
        email_id = request_data.get("email_id")
        
        if not email_id:
            raise HTTPException(status_code=400, detail="email_id is required")
        
        result = await smart_drafting.process_incoming_email(email_id, db)
        
        return result
        
    except Exception as e:
        logger.error(f"Error in auto_process_email endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/draft/status/{email_id}")
async def get_draft_status(
    email_id: str,
    db: Session = Depends(get_db)
):
    """
    Get the status of a draft for a specific email.
    """
    try:
        # This would check if a draft exists for the email
        # For now, return a simple status
        return {
            "email_id": email_id,
            "has_draft": False,  # This would be checked against a database
            "status": "no_draft_found"
        }
        
    except Exception as e:
        logger.error(f"Error getting draft status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/draft/test")
async def test_draft_generation(
    test_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Test draft generation with sample data.
    
    Request body:
    {
        "subject": "string",
        "sender": "string",
        "body": "string",
        "thread_summary": "string"
    }
    """
    try:
        subject = test_data.get("subject", "Test Email")
        sender = test_data.get("sender", "test@example.com")
        body = test_data.get("body", "This is a test email body.")
        thread_summary = test_data.get("thread_summary", "Test thread summary")
        
        # Create a mock email object
        mock_email = {
            "subject": subject,
            "from": {
                "emailAddress": {
                    "address": sender,
                    "name": sender.split("@")[0]
                }
            },
            "body": {
                "content": body
            }
        }
        
        # Generate draft content
        draft_content = await smart_drafting._generate_smart_draft(
            mock_email, thread_summary, subject, db
        )
        
        if draft_content:
            sensitive_topics = smart_drafting._check_sensitive_topics(draft_content)
            word_count = len(draft_content.split())
            
            return {
                "success": True,
                "draft_content": draft_content,
                "word_count": word_count,
                "sensitive_topics": sensitive_topics,
                "meets_requirements": 120 <= word_count <= 180,
                "message": "Test draft generated successfully"
            }
        else:
            return {
                "success": False,
                "error": "Failed to generate test draft"
            }
            
    except Exception as e:
        logger.error(f"Error in test_draft_generation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/draft/guidelines")
async def get_drafting_guidelines():
    """
    Get the drafting guidelines and requirements.
    """
    return {
        "guidelines": {
            "tone": "Tom Stanley - decisive, professional, hospitality-savvy",
            "language": "UK English spelling and terminology",
            "length": "120-180 words",
            "format": "Professional email reply",
            "header": "Drafted by Aimelia",
            "safety": "Never auto-send, always create drafts",
            "flagging": "Flag sensitive topics (banking, money, legal)"
        },
        "sensitive_topics": [
            "banking", "money", "payment", "cost", "price", "fee",
            "salary", "wage", "payroll", "VAT", "tax", "HMRC",
            "contract", "agreement", "legal", "confidential"
        ],
        "examples": {
            "good_length": "120-180 words",
            "uk_spelling": "organisation, colour, centre",
            "hospitality_terms": "tronc, service charge, hospitality group"
        }
    }
