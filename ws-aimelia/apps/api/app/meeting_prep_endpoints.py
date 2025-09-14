"""
API endpoints for meeting preparation functionality.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any, Optional
from .db import get_db
from .meeting_prep import meeting_prep
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/prep/next24h")
async def prep_next_24h_meetings(
    db: Session = Depends(get_db)
):
    """
    Prepare briefs for all meetings in the next 24 hours.
    This is the main endpoint for automatic meeting preparation.
    """
    try:
        result = await meeting_prep.prep_next_24h_meetings(db)
        return result
        
    except Exception as e:
        logger.error(f"Error in prep_next_24h_meetings endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/prep/specific-meeting")
async def prep_specific_meeting(
    request_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Prepare a brief for a specific meeting.
    
    Request body:
    {
        "event_id": "string"
    }
    """
    try:
        event_id = request_data.get("event_id")
        
        if not event_id:
            raise HTTPException(status_code=400, detail="event_id is required")
        
        # This would fetch the specific event and prepare it
        # For now, return a placeholder response
        return {
            "success": True,
            "message": f"Meeting preparation for event {event_id} initiated",
            "event_id": event_id
        }
        
    except Exception as e:
        logger.error(f"Error in prep_specific_meeting endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/prep/status")
async def get_prep_status(
    db: Session = Depends(get_db)
):
    """
    Get the status of meeting preparation.
    """
    try:
        # This would check the status of recent preparations
        return {
            "status": "ready",
            "last_prep_run": "2024-01-15T10:00:00Z",
            "meetings_prepared_today": 0,
            "next_scheduled_prep": "2024-01-15T18:00:00Z"
        }
        
    except Exception as e:
        logger.error(f"Error getting prep status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/prep/test")
async def test_meeting_prep(
    test_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Test meeting preparation with sample data.
    
    Request body:
    {
        "subject": "string",
        "start_time": "string",
        "attendees": ["string"],
        "location": "string"
    }
    """
    try:
        subject = test_data.get("subject", "Test Meeting")
        start_time = test_data.get("start_time", "2024-01-15T14:00:00Z")
        attendees = test_data.get("attendees", ["test@example.com"])
        location = test_data.get("location", "Conference Room A")
        
        # Create a mock event
        mock_event = {
            "id": "test-event-123",
            "subject": subject,
            "start": {"dateTime": start_time},
            "end": {"dateTime": "2024-01-15T15:00:00Z"},
            "attendees": [{"emailAddress": {"address": email, "name": email.split("@")[0]}} for email in attendees],
            "location": {"displayName": location},
            "organizer": {"emailAddress": {"name": "Test Organizer", "address": "organizer@example.com"}}
        }
        
        # Generate test brief
        brief_content = await meeting_prep._create_ai_brief(
            mock_event, [], db
        )
        
        if brief_content:
            word_count = len(brief_content.split())
            
            return {
                "success": True,
                "brief_content": brief_content,
                "word_count": word_count,
                "meets_requirements": word_count <= 400,
                "meeting_subject": subject,
                "message": "Test meeting brief generated successfully"
            }
        else:
            return {
                "success": False,
                "error": "Failed to generate test brief"
            }
            
    except Exception as e:
        logger.error(f"Error in test_meeting_prep: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/prep/guidelines")
async def get_prep_guidelines():
    """
    Get the meeting preparation guidelines and requirements.
    """
    return {
        "guidelines": {
            "purpose": "Prep Tom Stanley like a star for every meeting",
            "format": "Comprehensive brief with 6 key sections",
            "max_words": 400,
            "tone": "Professional, decisive, hospitality-savvy",
            "language": "UK English spelling and terminology"
        },
        "brief_sections": {
            "1_snapshot": "Meeting time, attendees, location",
            "2_recent_comms": "Key communications leading to meeting",
            "3_open_actions": "Outstanding items from previous meetings",
            "4_talking_points": "5 key discussion topics",
            "5_risks": "Potential challenges and sensitive topics",
            "6_next_steps": "Clear action items and follow-ups"
        },
        "requirements": {
            "word_limit": "Maximum 400 words total",
            "uk_spelling": "organisation, colour, centre",
            "hospitality_focus": "Industry-specific context and terminology",
            "actionable": "Clear next steps and decisions needed",
            "footer": "Prepared by Aimelia"
        },
        "examples": {
            "good_brief": "Concise, actionable, industry-relevant",
            "talking_points": "Specific agenda items, not generic topics",
            "risks": "Real challenges, not obvious concerns"
        }
    }

@router.post("/prep/schedule")
async def schedule_prep_runs(
    request_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """
    Schedule automatic meeting preparation runs.
    
    Request body:
    {
        "frequency": "daily|hourly|custom",
        "time": "HH:MM" (for daily),
        "enabled": true
    }
    """
    try:
        frequency = request_data.get("frequency", "daily")
        time = request_data.get("time", "18:00")
        enabled = request_data.get("enabled", True)
        
        # This would set up scheduled runs
        # For now, return confirmation
        return {
            "success": True,
            "scheduled": {
                "frequency": frequency,
                "time": time,
                "enabled": enabled,
                "next_run": "2024-01-15T18:00:00Z"
            },
            "message": "Meeting preparation scheduling updated"
        }
        
    except Exception as e:
        logger.error(f"Error scheduling prep runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))
