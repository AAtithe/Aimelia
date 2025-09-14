"""
Meeting brief generation with AI-powered intelligence.
Creates comprehensive meeting briefs using OpenAI for context and insights.
"""
from datetime import datetime
from typing import Dict, Any, List
from .ai_service import ai_service
import logging

logger = logging.getLogger(__name__)

def render_brief_html(event: dict, recent_summaries: list[str]) -> str:
    """
    Legacy fallback brief generation (non-AI).
    
    Args:
        event: Calendar event data
        recent_summaries: List of recent email summaries
        
    Returns:
        HTML formatted brief
    """
    who = ", ".join([a.get("emailAddress", {}).get("address", "") for a in event.get("attendees", [])])
    body = f"""
    <h3>Snapshot</h3>
    <p><strong>When:</strong> {event.get('start',{}).get('dateTime','')}<br>
    <strong>Attendees:</strong> {who}</p>
    <h3>Recent Comms</h3>
    <ul>{''.join(f'<li>{x}</li>' for x in recent_summaries[:6])}</ul>
    <h3>Talking Points</h3>
    <ol><li>Topic 1</li><li>Topic 2</li><li>Topic 3</li></ol>
    <h3>Next steps</h3>
    <ul><li>Owner – date</li></ul>
    <p><em>Prepared by Aimelia (Legacy)</em></p>
    """
    return body

async def generate_ai_brief(event: Dict[str, Any], recent_emails: List[Dict[str, Any]]) -> str:
    """
    Generate an AI-powered meeting brief.
    
    Args:
        event: Calendar event data
        recent_emails: Recent email communications with attendees
        
    Returns:
        HTML formatted AI-generated brief
    """
    try:
        brief = await ai_service.generate_meeting_brief(event, recent_emails)
        logger.info(f"Generated AI brief for meeting: {event.get('subject', 'Unknown')}")
        return brief
    except Exception as e:
        logger.error(f"AI brief generation failed: {e}")
        # Fallback to legacy brief
        recent_summaries = [email.get("subject", "") for email in recent_emails[:6]]
        return render_brief_html(event, recent_summaries)

async def generate_brief_with_context(event: Dict[str, Any], recent_emails: List[Dict[str, Any]], 
                                    additional_context: str = "") -> str:
    """
    Generate a meeting brief with additional context.
    
    Args:
        event: Calendar event data
        recent_emails: Recent email communications
        additional_context: Additional context to include
        
    Returns:
        HTML formatted brief
    """
    try:
        # Enhance the event data with additional context
        enhanced_event = event.copy()
        if additional_context:
            enhanced_event["additional_context"] = additional_context
        
        brief = await ai_service.generate_meeting_brief(enhanced_event, recent_emails)
        logger.info(f"Generated contextual brief for: {event.get('subject', 'Unknown')}")
        return brief
    except Exception as e:
        logger.error(f"Contextual brief generation failed: {e}")
        return render_brief_html(event, [email.get("subject", "") for email in recent_emails[:6]])

def format_brief_metadata(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract and format meeting metadata for brief generation.
    
    Args:
        event: Calendar event data
        
    Returns:
        Formatted metadata
    """
    return {
        "subject": event.get("subject", "Meeting"),
        "start_time": event.get("start", {}).get("dateTime", ""),
        "end_time": event.get("end", {}).get("dateTime", ""),
        "location": event.get("location", {}).get("displayName", ""),
        "attendees": [a.get("emailAddress", {}).get("address", "") for a in event.get("attendees", [])],
        "organizer": event.get("organizer", {}).get("emailAddress", {}).get("address", ""),
        "body": event.get("body", {}).get("content", ""),
        "is_online": event.get("isOnlineMeeting", False),
        "meeting_url": event.get("onlineMeeting", {}).get("joinUrl", "")
    }