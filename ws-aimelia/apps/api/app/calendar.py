from fastapi import APIRouter, Depends, HTTPException
import httpx, datetime as dt
from sqlalchemy.orm import Session
import logging
from .settings import settings
from .db import get_db
from .token_manager import token_manager
from .briefs import generate_ai_brief, format_brief_metadata
from .ai_service import ai_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calendar", tags=["calendar"])

@router.get("/next24")
async def next_24h(db: Session = Depends(get_db)):
    """Get calendar events for the next 24 hours with authenticated token."""
    try:
        access_token = await token_manager.get_valid_access_token(db, "tom")
        if not access_token:
            raise HTTPException(
                status_code=401, 
                detail="No valid access token available. Please authenticate first."
            )
        
        start = dt.datetime.utcnow()
        end = start + dt.timedelta(hours=24)
        params = {
            "startDateTime": start.isoformat()+"Z",
            "endDateTime": end.isoformat()+"Z",
            "$top": 20,
            "$orderby": "start/dateTime"
        }
        
        async with httpx.AsyncClient() as client:
            r = await client.get("https://graph.microsoft.com/v1.0/me/calendarView",
                                 headers={"Authorization": f"Bearer {access_token}"}, params=params)
            r.raise_for_status()
            return r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calendar fetch failed: {str(e)}")

@router.post("/brief/{event_id}")
async def generate_meeting_brief(event_id: str, db: Session = Depends(get_db)):
    """Generate an AI-powered meeting brief for a specific event."""
    try:
        access_token = await token_manager.get_valid_access_token(db, "tom")
        if not access_token:
            raise HTTPException(
                status_code=401, 
                detail="No valid access token available. Please authenticate first."
            )
        
        # Fetch the specific event
        event = await graph_get(f"/me/events/{event_id}", access_token)
        
        # Get attendees' email addresses
        attendees = [a.get("emailAddress", {}).get("address", "") for a in event.get("attendees", [])]
        
        # Fetch recent emails from attendees
        recent_emails = []
        for attendee in attendees:
            if attendee:  # Skip empty addresses
                try:
                    emails = await graph_get("/me/messages", access_token, {
                        "$filter": f"from/emailAddress/address eq '{attendee}'",
                        "$top": 3,
                        "$orderby": "receivedDateTime desc"
                    })
                    recent_emails.extend(emails.get("value", []))
                except:
                    continue  # Skip if can't fetch emails for this attendee
        
        # Generate AI brief
        brief_html = await generate_ai_brief(event, recent_emails)
        
        # Format metadata
        metadata = format_brief_metadata(event)
        
        return {
            "status": "ok",
            "event_id": event_id,
            "brief_html": brief_html,
            "metadata": metadata,
            "attendees": attendees,
            "recent_emails_count": len(recent_emails)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Brief generation failed: {str(e)}")

@router.get("/briefs/upcoming")
async def get_upcoming_briefs(db: Session = Depends(get_db)):
    """Get AI-generated briefs for all upcoming meetings in the next 24 hours."""
    try:
        access_token = await token_manager.get_valid_access_token(db, "tom")
        if not access_token:
            raise HTTPException(
                status_code=401, 
                detail="No valid access token available. Please authenticate first."
            )
        
        # Fetch upcoming events
        start = dt.datetime.utcnow()
        end = start + dt.timedelta(hours=24)
        params = {
            "startDateTime": start.isoformat()+"Z",
            "endDateTime": end.isoformat()+"Z",
            "$top": 10,
            "$orderby": "start/dateTime"
        }
        
        events_response = await graph_get("/me/calendarView", access_token, params)
        events = events_response.get("value", [])
        
        # Generate briefs for each event
        briefs = []
        for event in events:
            try:
                # Get attendees
                attendees = [a.get("emailAddress", {}).get("address", "") for a in event.get("attendees", [])]
                
                # Fetch recent emails (simplified - just get recent emails)
                recent_emails = await graph_get("/me/messages", access_token, {
                    "$top": 5,
                    "$orderby": "receivedDateTime desc"
                })
                
                # Generate brief
                brief_html = await generate_ai_brief(event, recent_emails.get("value", []))
                
                briefs.append({
                    "event_id": event.get("id"),
                    "subject": event.get("subject"),
                    "start_time": event.get("start", {}).get("dateTime"),
                    "attendees": attendees,
                    "brief_html": brief_html,
                    "metadata": format_brief_metadata(event)
                })
            except Exception as e:
                logger.error(f"Failed to generate brief for event {event.get('id')}: {e}")
                continue
        
        return {
            "status": "ok",
            "briefs_count": len(briefs),
            "briefs": briefs
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upcoming briefs failed: {str(e)}")

async def graph_get(path: str, access_token: str, params=None):
    """Make authenticated GET request to Microsoft Graph."""
    async with httpx.AsyncClient() as client:
        r = await client.get(f"https://graph.microsoft.com/v1.0{path}",
                             headers={"Authorization": f"Bearer {access_token}"}, params=params)
        r.raise_for_status()
        return r.json()