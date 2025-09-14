"""
Email triage system with AI-powered classification.
Combines rule-based and LLM classification for accurate email categorization.
"""
from typing import Dict, Any, Optional
from .ai_service import ai_service
import logging

logger = logging.getLogger(__name__)

def quick_rules(subject: str, sender: str) -> Optional[str]:
    """
    Quick rule-based classification for obvious categories.
    
    Args:
        subject: Email subject
        sender: Sender email address
        
    Returns:
        Category name or None if no rules match
    """
    s = (subject or "").lower()
    f = (sender or "").lower()
    
    if any(k in s for k in ["payslip", "timesheet", "payroll"]):
        return "Payroll"
    if any(k in s for k in ["vat", "paye", "nic", "hmrc"]):
        return "Tax"
    if "meeting" in s or "calendar" in s:
        return "Scheduling"
    if any(k in s for k in ["urgent", "asap", "immediately"]):
        return "Urgent"
    if any(k in f for k in ["noreply", "no-reply", "automated"]):
        return "Automated"
    
    return None

async def classify_email_ai(subject: str, sender: str, body: str) -> Dict[str, Any]:
    """
    Classify email using AI for intelligent categorization.
    
    Args:
        subject: Email subject
        sender: Sender email address
        body: Email body content
        
    Returns:
        Classification results with category, urgency, confidence, etc.
    """
    return await ai_service.classify_email(subject, sender, body)

async def triage_email(email: Dict[str, Any]) -> Dict[str, Any]:
    """
    Complete email triage process combining rules and AI.
    
    Args:
        email: Email object with subject, sender, body, etc.
        
    Returns:
        Triage results with classification and recommendations
    """
    subject = email.get("subject", "")
    sender = email.get("from", {}).get("emailAddress", {}).get("address", "")
    body = email.get("bodyPreview", "")
    
    # Try rule-based classification first
    rule_category = quick_rules(subject, sender)
    
    if rule_category:
        logger.info(f"Email classified by rules: {rule_category}")
        return {
            "category": rule_category,
            "urgency": 3,  # Default urgency
            "confidence": 0.9,  # High confidence for rules
            "method": "rules",
            "reasoning": "Matched rule-based patterns"
        }
    
    # Fall back to AI classification
    try:
        ai_result = await classify_email_ai(subject, sender, body)
        ai_result["method"] = "ai"
        logger.info(f"Email classified by AI: {ai_result['category']}")
        return ai_result
    except Exception as e:
        logger.error(f"AI classification failed: {e}")
        return {
            "category": "General",
            "urgency": 3,
            "confidence": 0.0,
            "method": "fallback",
            "reasoning": f"Classification failed: {str(e)}"
        }

def get_urgency_level(urgency: int) -> str:
    """Convert numeric urgency to human-readable level."""
    if urgency >= 5:
        return "Critical"
    elif urgency >= 4:
        return "High"
    elif urgency >= 3:
        return "Medium"
    elif urgency >= 2:
        return "Low"
    else:
        return "Very Low"