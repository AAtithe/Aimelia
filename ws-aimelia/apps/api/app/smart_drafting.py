"""
Smart Email Drafting Service for Aimelia.
Automatically drafts Outlook replies in Tom Stanley's tone.
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
import re

logger = logging.getLogger(__name__)

class SmartDraftingService:
    """Handles intelligent email drafting with Tom Stanley's voice."""
    
    def __init__(self):
        self.base_url = "https://graph.microsoft.com/v1.0"
    
    async def draft_smart_reply(self, email_id: str, thread_summary: str, 
                               subject: str, db: Session) -> Dict[str, Any]:
        """
        Draft a smart reply to an email using Tom Stanley's tone.
        
        Args:
            email_id: Microsoft Graph email ID
            thread_summary: Summary of the email thread
            subject: Email subject line
            db: Database session
            
        Returns:
            Dict with draft status and details
        """
        try:
            # Get valid access token
            access_token = await token_manager.get_valid_access_token(db, "tom")
            if not access_token:
                return {
                    "success": False,
                    "error": "No valid access token available. Please re-authenticate."
                }
            
            # Fetch the original email for context
            original_email = await self._fetch_email(access_token, email_id)
            if not original_email:
                return {
                    "success": False,
                    "error": "Could not fetch original email"
                }
            
            # Generate smart draft using AI
            draft_content = await self._generate_smart_draft(
                original_email, thread_summary, subject, db
            )
            
            if not draft_content:
                return {
                    "success": False,
                    "error": "Failed to generate draft content"
                }
            
            # Create Outlook draft
            draft_result = await self._create_outlook_draft(
                access_token, original_email, draft_content
            )
            
            if draft_result["success"]:
                logger.info(f"Successfully created smart draft for email {email_id}")
                return {
                    "success": True,
                    "draft_id": draft_result["draft_id"],
                    "subject": f"Re: {subject}",
                    "preview": draft_content[:100] + "...",
                    "word_count": len(draft_content.split()),
                    "sensitive_topics": self._check_sensitive_topics(draft_content),
                    "message": "Smart draft created successfully"
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to create Outlook draft: {draft_result.get('error', 'Unknown error')}"
                }
                
        except Exception as e:
            logger.error(f"Error in smart drafting: {e}")
            return {
                "success": False,
                "error": f"Smart drafting failed: {str(e)}"
            }
    
    async def _fetch_email(self, access_token: str, email_id: str) -> Optional[Dict[str, Any]]:
        """Fetch the original email from Microsoft Graph."""
        try:
            headers = {"Authorization": f"Bearer {access_token}"}
            url = f"{self.base_url}/me/messages/{email_id}"
            
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                return response.json()
                
        except Exception as e:
            logger.error(f"Error fetching email {email_id}: {e}")
            return None
    
    async def _generate_smart_draft(self, original_email: Dict[str, Any], 
                                  thread_summary: str, subject: str, 
                                  db: Session) -> Optional[str]:
        """Generate smart draft content using AI with Tom Stanley's persona."""
        try:
            # Extract email details
            sender = original_email.get("from", {}).get("emailAddress", {}).get("address", "")
            sender_name = original_email.get("from", {}).get("emailAddress", {}).get("name", "")
            body_content = original_email.get("body", {}).get("content", "")
            
            # Build context for AI
            meta = {
                "subject": subject,
                "sender": sender,
                "sender_name": sender_name,
                "thread_summary": thread_summary,
                "original_body": body_content[:500],  # First 500 chars
                "task": "email_reply"
            }
            
            query = f"{sender} {subject} {thread_summary} email reply"
            
            # Get context-aware AI response
            messages = await context_builder.build_context("reply", meta, query)
            
            # Add specific instructions for email drafting
            draft_instructions = """
            You are drafting an email reply as Tom Stanley from Williams, Stanley & Co.
            
            Requirements:
            - Use UK English spelling and terminology
            - Be decisive and professional but friendly
            - Keep response between 120-180 words
            - Address the sender's specific points
            - Include clear next steps or actions
            - Use hospitality industry expertise when relevant
            - Be concise but comprehensive
            
            Format as a professional email reply (no headers, just body content).
            """
            
            messages.append({"role": "user", "content": draft_instructions})
            
            # Generate the draft
            response = await ai_service.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.3,
                max_tokens=400
            )
            
            draft_content = response.choices[0].message.content.strip()
            
            # Add Aimelia header
            final_draft = f"Drafted by Aimelia\n\n{draft_content}"
            
            logger.info(f"Generated smart draft for {subject}")
            return final_draft
            
        except Exception as e:
            logger.error(f"Error generating smart draft: {e}")
            return None
    
    async def _create_outlook_draft(self, access_token: str, original_email: Dict[str, Any], 
                                  draft_content: str) -> Dict[str, Any]:
        """Create an Outlook draft using Microsoft Graph API."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            
            # Extract original email details
            subject = original_email.get("subject", "")
            to_recipients = original_email.get("from", {}).get("emailAddress", {})
            cc_recipients = original_email.get("ccRecipients", [])
            bcc_recipients = original_email.get("bccRecipients", [])
            
            # Build draft payload
            draft_payload = {
                "subject": f"Re: {subject}",
                "body": {
                    "contentType": "text",
                    "content": draft_content
                },
                "toRecipients": [to_recipients],
                "ccRecipients": cc_recipients,
                "bccRecipients": bcc_recipients,
                "isDraft": True
            }
            
            url = f"{self.base_url}/me/messages"
            
            async with httpx.AsyncClient() as client:
                response = await client.post(url, headers=headers, json=draft_payload)
                response.raise_for_status()
                result = response.json()
                
                return {
                    "success": True,
                    "draft_id": result.get("id"),
                    "draft_url": f"https://outlook.office.com/mail/deeplink/compose?mailto={to_recipients.get('address', '')}&subject={subject}"
                }
                
        except Exception as e:
            logger.error(f"Error creating Outlook draft: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    def _check_sensitive_topics(self, content: str) -> List[str]:
        """Check for sensitive topics that need flagging."""
        sensitive_keywords = [
            "bank", "banking", "account", "payment", "money", "cost", "price", "fee",
            "salary", "wage", "payroll", "vat", "tax", "hmrc", "revenue",
            "contract", "agreement", "legal", "terms", "conditions",
            "confidential", "private", "sensitive", "personal"
        ]
        
        found_topics = []
        content_lower = content.lower()
        
        for keyword in sensitive_keywords:
            if keyword in content_lower:
                found_topics.append(keyword)
        
        return found_topics
    
    async def process_incoming_email(self, email_id: str, db: Session) -> Dict[str, Any]:
        """
        Process an incoming email and automatically create a smart draft.
        This is called when new emails are received.
        """
        try:
            # Get valid access token
            access_token = await token_manager.get_valid_access_token(db, "tom")
            if not access_token:
                return {
                    "success": False,
                    "error": "No valid access token available"
                }
            
            # Fetch email details
            email = await self._fetch_email(access_token, email_id)
            if not email:
                return {
                    "success": False,
                    "error": "Could not fetch email"
                }
            
            # Extract email details
            subject = email.get("subject", "")
            sender = email.get("from", {}).get("emailAddress", {}).get("address", "")
            body = email.get("body", {}).get("content", "")
            
            # Create thread summary (simplified for now)
            thread_summary = f"Email from {sender} regarding {subject}"
            
            # Generate smart draft
            result = await self.draft_smart_reply(email_id, thread_summary, subject, db)
            
            if result["success"]:
                logger.info(f"Auto-drafted reply for email {email_id}")
                return {
                    "success": True,
                    "email_id": email_id,
                    "subject": subject,
                    "sender": sender,
                    "draft_created": True,
                    "draft_id": result["draft_id"],
                    "sensitive_topics": result.get("sensitive_topics", []),
                    "message": "Smart draft created automatically"
                }
            else:
                return {
                    "success": False,
                    "error": result.get("error", "Failed to create draft"),
                    "email_id": email_id
                }
                
        except Exception as e:
            logger.error(f"Error processing incoming email {email_id}: {e}")
            return {
                "success": False,
                "error": f"Failed to process email: {str(e)}",
                "email_id": email_id
            }

# Global instance
smart_drafting = SmartDraftingService()
