"""
AI Service for OpenAI integration in Aimelia.
Provides intelligent email triage, meeting briefs, and content generation.
"""
import openai
from typing import List, Dict, Any, Optional
from .settings import settings
import logging
import json

logger = logging.getLogger(__name__)

class AIService:
    """AI service for OpenAI integration with intelligent features."""
    
    def __init__(self):
        if not settings.OPENAI_API_KEY:
            logger.warning("OpenAI API key not configured. AI features will be disabled.")
            self.enabled = False
        else:
            openai.api_key = settings.OPENAI_API_KEY
            self.enabled = True
    
    async def classify_email(self, subject: str, sender: str, body: str) -> Dict[str, Any]:
        """
        Classify an email using AI for better categorization.
        
        Args:
            subject: Email subject
            sender: Sender email address
            body: Email body content
            
        Returns:
            Dict with classification results
        """
        if not self.enabled:
            return {"category": "General", "urgency": 3, "confidence": 0.0, "reasoning": "AI disabled"}
        
        try:
            prompt = f"""
            Analyze this email and classify it:
            
            Subject: {subject}
            From: {sender}
            Body: {body[:500]}...
            
            Classify into one of these categories:
            - Urgent: Requires immediate attention (deadlines, emergencies)
            - Important: Business critical but not urgent
            - Payroll: Salary, timesheets, payment related
            - Tax: VAT, PAYE, HMRC, tax related
            - Scheduling: Meetings, calendar, appointments
            - General: Other business communications
            - Spam: Unwanted or promotional content
            
            Also assess urgency (1-5, where 5 is most urgent).
            
            Respond in JSON format:
            {{
                "category": "category_name",
                "urgency": urgency_number,
                "confidence": confidence_0_to_1,
                "reasoning": "brief_explanation",
                "action_required": "what_should_be_done"
            }}
            """
            
            response = await openai.ChatCompletion.acreate(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=300
            )
            
            result = json.loads(response.choices[0].message.content)
            logger.info(f"Email classified: {result['category']} (urgency: {result['urgency']})")
            return result
            
        except Exception as e:
            logger.error(f"Email classification failed: {e}")
            return {"category": "General", "urgency": 3, "confidence": 0.0, "reasoning": f"Error: {str(e)}"}
    
    async def generate_meeting_brief(self, event: Dict[str, Any], recent_emails: List[Dict[str, Any]]) -> str:
        """
        Generate an intelligent meeting brief using AI.
        
        Args:
            event: Calendar event data
            recent_emails: Recent email communications with attendees
            
        Returns:
            HTML formatted meeting brief
        """
        if not self.enabled:
            return self._fallback_brief(event, recent_emails)
        
        try:
            # Extract event details
            attendees = [a.get("emailAddress", {}).get("address", "") for a in event.get("attendees", [])]
            subject = event.get("subject", "Meeting")
            start_time = event.get("start", {}).get("dateTime", "")
            body = event.get("body", {}).get("content", "")
            
            # Prepare email context
            email_context = ""
            for email in recent_emails[:5]:  # Last 5 emails
                email_context += f"From: {email.get('from', {}).get('emailAddress', {}).get('address', '')}\n"
                email_context += f"Subject: {email.get('subject', '')}\n"
                email_context += f"Body: {email.get('bodyPreview', '')[:200]}...\n\n"
            
            prompt = f"""
            Create a comprehensive meeting brief for this meeting:
            
            Meeting: {subject}
            Time: {start_time}
            Attendees: {', '.join(attendees)}
            Description: {body[:300]}...
            
            Recent communications with attendees:
            {email_context}
            
            Generate a professional meeting brief with:
            1. Meeting snapshot (time, attendees, purpose)
            2. Key talking points based on recent communications
            3. Background context from emails
            4. Suggested next steps
            5. Any action items or follow-ups needed
            
            Format as HTML with proper headings and structure.
            Be concise but comprehensive.
            """
            
            response = await openai.ChatCompletion.acreate(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                max_tokens=800
            )
            
            brief = response.choices[0].message.content
            logger.info(f"Generated AI meeting brief for: {subject}")
            return brief
            
        except Exception as e:
            logger.error(f"Meeting brief generation failed: {e}")
            return self._fallback_brief(event, recent_emails)
    
    async def summarize_email_thread(self, emails: List[Dict[str, Any]]) -> str:
        """
        Summarize a thread of emails using AI.
        
        Args:
            emails: List of email objects in the thread
            
        Returns:
            Summary of the email thread
        """
        if not self.enabled:
            return "AI summarization not available."
        
        try:
            # Prepare thread context
            thread_context = ""
            for email in emails[-10:]:  # Last 10 emails in thread
                thread_context += f"From: {email.get('from', {}).get('emailAddress', {}).get('address', '')}\n"
                thread_context += f"Subject: {email.get('subject', '')}\n"
                thread_context += f"Date: {email.get('receivedDateTime', '')}\n"
                thread_context += f"Body: {email.get('bodyPreview', '')[:300]}...\n\n"
            
            prompt = f"""
            Summarize this email thread:
            
            {thread_context}
            
            Provide a concise summary including:
            - Main topic/subject
            - Key points discussed
            - Decisions made
            - Action items or next steps
            - Current status
            
            Keep it under 200 words.
            """
            
            response = await openai.ChatCompletion.acreate(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=300
            )
            
            summary = response.choices[0].message.content
            logger.info("Generated email thread summary")
            return summary
            
        except Exception as e:
            logger.error(f"Email thread summarization failed: {e}")
            return "Summary generation failed."
    
    async def generate_email_response(self, original_email: Dict[str, Any], context: str = "") -> str:
        """
        Generate a suggested email response using AI.
        
        Args:
            original_email: The email to respond to
            context: Additional context for the response
            
        Returns:
            Suggested email response
        """
        if not self.enabled:
            return "AI response generation not available."
        
        try:
            subject = original_email.get("subject", "")
            sender = original_email.get("from", {}).get("emailAddress", {}).get("address", "")
            body = original_email.get("bodyPreview", "")
            
            prompt = f"""
            Generate a professional email response to this email:
            
            From: {sender}
            Subject: {subject}
            Body: {body[:500]}...
            
            Context: {context}
            
            Generate a professional, helpful response that:
            - Acknowledges the original message
            - Addresses any questions or requests
            - Is concise but complete
            - Maintains a professional tone
            - Includes appropriate next steps if needed
            
            Do not include email headers, just the response body.
            """
            
            response = await openai.ChatCompletion.acreate(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.5,
                max_tokens=400
            )
            
            reply = response.choices[0].message.content
            logger.info(f"Generated email response for: {subject}")
            return reply
            
        except Exception as e:
            logger.error(f"Email response generation failed: {e}")
            return "Response generation failed."
    
    def _fallback_brief(self, event: Dict[str, Any], recent_emails: List[Dict[str, Any]]) -> str:
        """Fallback brief when AI is not available."""
        who = ", ".join([a.get("emailAddress", {}).get("address", "") for a in event.get("attendees", [])])
        recent_summaries = [email.get("subject", "") for email in recent_emails[:6]]
        
        return f"""
        <h3>Snapshot</h3>
        <p><strong>When:</strong> {event.get('start',{}).get('dateTime','')}<br>
        <strong>Attendees:</strong> {who}</p>
        <h3>Recent Comms</h3>
        <ul>{''.join(f'<li>{x}</li>' for x in recent_summaries)}</ul>
        <h3>Talking Points</h3>
        <ol><li>Topic 1</li><li>Topic 2</li><li>Topic 3</li></ol>
        <h3>Next steps</h3>
        <ul><li>Owner – date</li></ul>
        <p><em>Prepared by Aimelia (AI unavailable)</em></p>
        """

# Global instance
ai_service = AIService()
