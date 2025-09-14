from fastapi import APIRouter, Depends, HTTPException
import httpx, datetime as dt
from sqlalchemy.orm import Session
from .settings import settings
from .db import get_db
from .token_manager import token_manager
from .triage import triage_email, get_urgency_level
from .ai_service import ai_service

router = APIRouter(prefix="/emails", tags=["emails"])

async def graph_get(path: str, access_token: str, params=None):
    """Make authenticated GET request to Microsoft Graph."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"https://graph.microsoft.com/v1.0{path}",
                             headers={"Authorization": f"Bearer {access_token}"}, params=params)
        r.raise_for_status()
        return r.json()

async def graph_post(path: str, access_token: str, json=None):
    """Make authenticated POST request to Microsoft Graph."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"https://graph.microsoft.com/v1.0{path}",
                              headers={"Authorization": f"Bearer {access_token}"}, json=json)
        r.raise_for_status()
        return r.json()

async def get_valid_token(db: Session) -> str:
    """Get a valid access token, refreshing if necessary."""
    access_token = await token_manager.get_valid_access_token(db, "tom")
    if not access_token:
        raise HTTPException(
            status_code=401, 
            detail="No valid access token available. Please authenticate first."
        )
    return access_token

@router.post("/triage/run")
async def run_triage(db: Session = Depends(get_db)):
    """Run AI-powered email triage with intelligent classification."""
    try:
        access_token = await get_valid_token(db)
        
        # Fetch recent messages
        messages = await graph_get("/me/messages", access_token, {
            "$top": 10,
            "$orderby": "receivedDateTime desc"
        })
        
        # Process each email with AI triage
        triaged_emails = []
        for email in messages.get("value", []):
            triage_result = await triage_email(email)
            triaged_emails.append({
                "id": email.get("id"),
                "subject": email.get("subject"),
                "from": email.get("from", {}).get("emailAddress", {}).get("address"),
                "received": email.get("receivedDateTime"),
                "triage": triage_result
            })
        
        # Sort by urgency
        triaged_emails.sort(key=lambda x: x["triage"]["urgency"], reverse=True)
        
        return {
            "status": "ok",
            "message_count": len(triaged_emails),
            "triaged_emails": triaged_emails,
            "summary": {
                "urgent": len([e for e in triaged_emails if e["triage"]["urgency"] >= 4]),
                "important": len([e for e in triaged_emails if e["triage"]["urgency"] == 3]),
                "low_priority": len([e for e in triaged_emails if e["triage"]["urgency"] <= 2])
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Triage failed: {str(e)}")

@router.post("/analyze/{email_id}")
async def analyze_email(email_id: str, db: Session = Depends(get_db)):
    """Analyze a specific email with AI for detailed insights."""
    try:
        access_token = await get_valid_token(db)
        
        # Fetch the specific email
        email = await graph_get(f"/me/messages/{email_id}", access_token)
        
        # Get full body content
        email_body = email.get("body", {}).get("content", "")
        
        # Run AI analysis
        triage_result = await triage_email(email)
        
        # Generate email summary
        summary = await ai_service.summarize_email_thread([email])
        
        # Generate suggested response
        suggested_response = await ai_service.generate_email_response(email)
        
        return {
            "status": "ok",
            "email": {
                "id": email.get("id"),
                "subject": email.get("subject"),
                "from": email.get("from", {}).get("emailAddress", {}).get("address"),
                "received": email.get("receivedDateTime"),
                "body_preview": email.get("bodyPreview", "")
            },
            "analysis": {
                "triage": triage_result,
                "summary": summary,
                "suggested_response": suggested_response,
                "urgency_level": get_urgency_level(triage_result["urgency"])
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email analysis failed: {str(e)}")

@router.post("/summarize-thread")
async def summarize_thread(thread_id: str, db: Session = Depends(get_db)):
    """Summarize an email thread using AI."""
    try:
        access_token = await get_valid_token(db)
        
        # Fetch emails in the thread
        messages = await graph_get(f"/me/messages/{thread_id}/thread", access_token)
        
        if not messages.get("value"):
            raise HTTPException(status_code=404, detail="Thread not found")
        
        # Generate AI summary
        summary = await ai_service.summarize_email_thread(messages["value"])
        
        return {
            "status": "ok",
            "thread_id": thread_id,
            "message_count": len(messages["value"]),
            "summary": summary
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thread summarization failed: {str(e)}")

@router.post("/drafts/create")
async def create_draft(to: str, subject: str, body_html: str, db: Session = Depends(get_db)):
    """Create an email draft with authenticated token."""
    try:
        access_token = await get_valid_token(db)
        
        payload = {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body_html + "<br><br><em>Drafted by Aimelia</em>"},
            "toRecipients": [{"emailAddress": {"address": to}}]
        }
        res = await graph_post("/me/messages", access_token, json=payload)
        return {"draft_id": res.get('id')}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Draft creation failed: {str(e)}")