"""
Meeting Preparation Service for Aimelia.
Generates comprehensive meeting briefs to prep Tom Stanley like a star.
"""
import httpx
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from .db import get_db
from .ai_service import ai_service
from .context_builder import context_builder
from .token_manager import token_manager
import logging
import json
from datetime import datetime, timedelta
import re

logger = logging.getLogger(__name__)

class MeetingPrepService:
    """Handles intelligent meeting preparation and brief generation."""
    
    def __init__(self):
        self.base_url = "https://graph.microsoft.com/v1.0"
    
    async def prep_next_24h_meetings(self, db: Session) -> Dict[str, Any]:
        """
        Prepare briefs for all meetings in the next 24 hours.
        
        Args:
            db: Database session
            
        Returns:
            Dict with preparation results
        """
        try:
            # Get valid access token
            access_token = await token_manager.get_valid_access_token(db, "tom")
            if not access_token:
                return {
                    "success": False,
                    "error": "No valid access token available. Please re-authenticate."
                }
            
            # Fetch next 24h events
            events = await self._fetch_next_24h_events(access_token)
            if not events:
                return {
                    "success": True,
                    "message": "No meetings found in the next 24 hours",
                    "meetings_prepared": 0
                }
            
            prepared_meetings = []
            errors = []
            
            # Process each meeting
            for event in events:
                try:
                    brief_result = await self._generate_meeting_brief(
                        event, access_token, db
                    )
                    
                    if brief_result["success"]:
                        prepared_meetings.append(brief_result)
                        logger.info(f"Prepared brief for meeting: {event.get('subject', 'Unknown')}")
                    else:
                        errors.append({
                            "meeting": event.get('subject', 'Unknown'),
                            "error": brief_result.get("error", "Unknown error")
                        })
                        
                except Exception as e:
                    logger.error(f"Error preparing meeting {event.get('subject', 'Unknown')}: {e}")
                    errors.append({
                        "meeting": event.get('subject', 'Unknown'),
                        "error": str(e)
                    })
            
            return {
                "success": True,
                "meetings_prepared": len(prepared_meetings),
                "total_meetings": len(events),
                "prepared_meetings": prepared_meetings,
                "errors": errors,
                "message": f"Successfully prepared {len(prepared_meetings)} out of {len(events)} meetings"
            }
            
        except Exception as e:
            logger.error(f"Error in prep_next_24h_meetings: {e}")
            return {
                "success": False,
                "error": f"Meeting preparation failed: {str(e)}"
            }
    
    async def _fetch_next_24h_events(self, access_token: str) -> List[Dict[str, Any]]:
        """Fetch events from the next 24 hours."""
        try:
            headers = {"Authorization": f"Bearer {access_token}"}
            
            # Calculate time range
            now = datetime.utcnow()
            start_time = now.isoformat() + "Z"
            end_time = (now + timedelta(hours=24)).isoformat() + "Z"
            
            url = f"{self.base_url}/me/calendarview"
            params = {
                "startDateTime": start_time,
                "endDateTime": end_time,
                "$orderby": "start/dateTime",
                "$select": "subject,start,end,attendees,body,location,organizer,isAllDay"
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params)
                response.raise_for_status()
                data = response.json()
                
                # Filter out all-day events and focus on meetings
                meetings = []
                for event in data.get("value", []):
                    if not event.get("isAllDay", False):
                        meetings.append(event)
                
                logger.info(f"Found {len(meetings)} meetings in next 24h")
                return meetings
                
        except Exception as e:
            logger.error(f"Error fetching next 24h events: {e}")
            return []
    
    async def _generate_meeting_brief(self, event: Dict[str, Any], 
                                    access_token: str, db: Session) -> Dict[str, Any]:
        """Generate a comprehensive meeting brief."""
        try:
            # Extract event details
            subject = event.get("subject", "Meeting")
            start_time = event.get("start", {}).get("dateTime", "")
            end_time = event.get("end", {}).get("dateTime", "")
            attendees = event.get("attendees", [])
            location = event.get("location", {}).get("displayName", "")
            organizer = event.get("organizer", {}).get("emailAddress", {})
            
            # Get recent communications with attendees
            recent_comms = await self._get_recent_communications(
                access_token, attendees, subject
            )
            
            # Generate AI-powered brief
            brief_content = await self._create_ai_brief(
                event, recent_comms, db
            )
            
            if not brief_content:
                return {
                    "success": False,
                    "error": "Failed to generate brief content"
                }
            
            # Save brief back to event or email it
            save_result = await self._save_brief(
                access_token, event, brief_content
            )
            
            return {
                "success": True,
                "meeting_subject": subject,
                "meeting_time": start_time,
                "brief_content": brief_content,
                "word_count": len(brief_content.split()),
                "attendees_count": len(attendees),
                "recent_comms_count": len(recent_comms),
                "saved_to": save_result.get("saved_to", "unknown"),
                "brief_id": save_result.get("brief_id")
            }
            
        except Exception as e:
            logger.error(f"Error generating meeting brief: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def _get_recent_communications(self, access_token: str, 
                                      attendees: List[Dict], 
                                      meeting_subject: str) -> List[Dict[str, Any]]:
        """Get recent email communications with meeting attendees."""
        try:
            headers = {"Authorization": f"Bearer {access_token}"}
            
            # Extract attendee emails
            attendee_emails = []
            for attendee in attendees:
                email = attendee.get("emailAddress", {}).get("address", "")
                if email:
                    attendee_emails.append(email)
            
            if not attendee_emails:
                return []
            
            # Search for recent emails with attendees
            search_query = f"from:({' OR from:'.join(attendee_emails)})"
            if meeting_subject:
                search_query += f" AND subject:{meeting_subject}"
            
            url = f"{self.base_url}/me/messages"
            params = {
                "$search": search_query,
                "$top": 10,
                "$orderby": "receivedDateTime desc",
                "$select": "subject,from,receivedDateTime,bodyPreview"
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params)
                response.raise_for_status()
                data = response.json()
                
                return data.get("value", [])
                
        except Exception as e:
            logger.error(f"Error getting recent communications: {e}")
            return []
    
    async def _create_ai_brief(self, event: Dict[str, Any], 
                             recent_comms: List[Dict], 
                             db: Session) -> Optional[str]:
        """Create AI-powered meeting brief using Tom Stanley's context."""
        try:
            # Extract event details
            subject = event.get("subject", "Meeting")
            start_time = event.get("start", {}).get("dateTime", "")
            end_time = event.get("end", {}).get("dateTime", "")
            attendees = event.get("attendees", [])
            location = event.get("location", {}).get("displayName", "")
            organizer = event.get("organizer", {}).get("emailAddress", {})
            
            # Format attendees
            attendee_list = []
            for attendee in attendees:
                name = attendee.get("emailAddress", {}).get("name", "")
                email = attendee.get("emailAddress", {}).get("address", "")
                if name and email:
                    attendee_list.append(f"{name} ({email})")
                elif email:
                    attendee_list.append(email)
            
            # Format recent communications
            comms_summary = ""
            for comm in recent_comms[:5]:  # Last 5 communications
                from_name = comm.get("from", {}).get("emailAddress", {}).get("name", "")
                subject_line = comm.get("subject", "")
                received = comm.get("receivedDateTime", "")
                preview = comm.get("bodyPreview", "")[:100]
                
                comms_summary += f"• {from_name}: {subject_line} ({received[:10]}) - {preview}...\n"
            
            # Build context for AI
            meta = {
                "meeting_subject": subject,
                "start_time": start_time,
                "end_time": end_time,
                "attendees": attendee_list,
                "location": location,
                "organizer": organizer.get("name", ""),
                "recent_comms": comms_summary,
                "task": "meeting_brief"
            }
            
            query = f"{subject} meeting brief {', '.join(attendee_list)}"
            
            # Get context-aware AI response
            messages = await context_builder.build_context("brief", meta, query)
            
            # Add specific meeting prep instructions
            prep_instructions = """
            You are preparing a comprehensive meeting brief for Tom Stanley at Williams, Stanley & Co.
            
            Create a polished, professional brief with these sections:
            
            1. SNAPSHOT
               - Meeting time and duration
               - Key attendees and their roles
               - Location/format
            
            2. RECENT COMMS
               - Key communications leading to this meeting
               - Important context and background
            
            3. OPEN ACTIONS
               - Outstanding items from previous meetings
               - Follow-ups that need addressing
            
            4. TALKING POINTS (5 key points)
               - Main agenda items
               - Critical discussion topics
               - Decisions that need to be made
            
            5. RISKS
               - Potential challenges or concerns
               - Sensitive topics to handle carefully
            
            6. NEXT STEPS
               - Clear action items for after the meeting
               - Follow-up requirements
            
            Requirements:
            - Maximum 400 words total
            - Use UK English spelling
            - Be decisive and professional
            - Focus on hospitality industry context
            - Make it actionable and insightful
            - Use bullet points for clarity
            
            Format as a clean, professional brief ready for Tom to review.
            """
            
            messages.append({"role": "user", "content": prep_instructions})
            
            # Generate the brief
            response = await ai_service.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.3,
                max_tokens=600
            )
            
            brief_content = response.choices[0].message.content.strip()
            
            # Add Aimelia footer
            final_brief = f"{brief_content}\n\n---\nPrepared by Aimelia"
            
            logger.info(f"Generated meeting brief for: {subject}")
            return final_brief
            
        except Exception as e:
            logger.error(f"Error creating AI brief: {e}")
            return None
    
    async def _save_brief(self, access_token: str, event: Dict[str, Any], 
                         brief_content: str) -> Dict[str, Any]:
        """Save the brief back to the event or email it."""
        try:
            event_id = event.get("id")
            subject = event.get("subject", "Meeting")
            
            # Option 1: Update event body with brief
            try:
                await self._update_event_body(access_token, event_id, brief_content)
                return {
                    "saved_to": "event_body",
                    "brief_id": event_id
                }
            except Exception as e:
                logger.warning(f"Failed to update event body: {e}")
            
            # Option 2: Email the brief to Tom
            try:
                email_id = await self._email_brief(access_token, subject, brief_content)
                return {
                    "saved_to": "email",
                    "brief_id": email_id
                }
            except Exception as e:
                logger.warning(f"Failed to email brief: {e}")
            
            return {
                "saved_to": "failed",
                "error": "Could not save brief"
            }
            
        except Exception as e:
            logger.error(f"Error saving brief: {e}")
            return {
                "saved_to": "error",
                "error": str(e)
            }
    
    async def _update_event_body(self, access_token: str, event_id: str, 
                               brief_content: str) -> bool:
        """Update the event body with the brief."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            # Get current event to preserve existing body
            url = f"{self.base_url}/me/events/{event_id}"
            
            async with httpx.AsyncClient() as client:
                # Get current event
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                current_event = response.json()
                
                # Update with brief
                current_body = current_event.get("body", {}).get("content", "")
                new_body = f"{brief_content}\n\n{current_body}"
                
                update_data = {
                    "body": {
                        "contentType": "text",
                        "content": new_body
                    }
                }
                
                # Update event
                response = await client.patch(url, headers=headers, json=update_data)
                response.raise_for_status()
                
                logger.info(f"Updated event body with brief: {event_id}")
                return True
                
        except Exception as e:
            logger.error(f"Error updating event body: {e}")
            raise e
    
    async def _email_brief(self, access_token: str, subject: str, 
                          brief_content: str) -> str:
        """Email the brief to Tom."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            email_data = {
                "message": {
                    "subject": f"Meeting Brief: {subject}",
                    "body": {
                        "contentType": "text",
                        "content": brief_content
                    },
                    "toRecipients": [
                        {
                            "emailAddress": {
                                "address": "tom@williamsstanley.co"  # Tom's email
                            }
                        }
                    ]
                },
                "saveToSentItems": True
            }
            
            url = f"{self.base_url}/me/sendMail"
            
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, json=email_data)
                response.raise_for_status()
                
                logger.info(f"Emailed brief for meeting: {subject}")
                return "emailed"
                
        except Exception as e:
            logger.error(f"Error emailing brief: {e}")
            raise e

# Global instance
meeting_prep = MeetingPrepService()
