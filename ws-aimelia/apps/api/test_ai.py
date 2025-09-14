#!/usr/bin/env python3
"""
Test script for AI integration.
Run this to verify OpenAI API is working correctly.
"""
import asyncio
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.ai_service import ai_service
from app.triage import triage_email
from app.briefs import generate_ai_brief

async def test_ai_features():
    """Test AI features with sample data."""
    print("🤖 Testing AI Integration...")
    
    # Test 1: Email Classification
    print("\n1. Testing Email Classification...")
    sample_email = {
        "subject": "Urgent: Q4 Budget Review Meeting Tomorrow",
        "from": {"emailAddress": {"address": "ceo@company.com"}},
        "bodyPreview": "We need to discuss the Q4 budget immediately. Please prepare your department's figures for tomorrow's 2pm meeting."
    }
    
    triage_result = await triage_email(sample_email)
    print(f"   Category: {triage_result['category']}")
    print(f"   Urgency: {triage_result['urgency']}")
    print(f"   Confidence: {triage_result['confidence']}")
    print(f"   Method: {triage_result['method']}")
    
    # Test 2: Meeting Brief Generation
    print("\n2. Testing Meeting Brief Generation...")
    sample_event = {
        "subject": "Q4 Budget Review",
        "start": {"dateTime": "2024-01-15T14:00:00Z"},
        "attendees": [
            {"emailAddress": {"address": "ceo@company.com"}},
            {"emailAddress": {"address": "cfo@company.com"}}
        ],
        "body": {"content": "Review Q4 budget performance and plan for Q1"}
    }
    
    sample_emails = [
        {
            "subject": "Budget figures for Q4",
            "from": {"emailAddress": {"address": "cfo@company.com"}},
            "bodyPreview": "Here are the preliminary Q4 budget figures..."
        }
    ]
    
    brief = await generate_ai_brief(sample_event, sample_emails)
    print(f"   Brief generated: {len(brief)} characters")
    print(f"   Preview: {brief[:200]}...")
    
    # Test 3: Email Summarization
    print("\n3. Testing Email Summarization...")
    sample_thread = [
        {
            "subject": "Project Alpha Update",
            "from": {"emailAddress": {"address": "pm@company.com"}},
            "receivedDateTime": "2024-01-15T10:00:00Z",
            "bodyPreview": "Project Alpha is on track for delivery next week..."
        },
        {
            "subject": "Re: Project Alpha Update",
            "from": {"emailAddress": {"address": "dev@company.com"}},
            "receivedDateTime": "2024-01-15T11:00:00Z",
            "bodyPreview": "Thanks for the update. We've completed the backend integration..."
        }
    ]
    
    summary = await ai_service.summarize_email_thread(sample_thread)
    print(f"   Summary: {summary}")
    
    print("\n✅ AI Integration Test Complete!")
    print("\n📋 Available AI Features:")
    print("   • Email classification and triage")
    print("   • Meeting brief generation")
    print("   • Email thread summarization")
    print("   • Suggested email responses")
    print("   • Intelligent urgency assessment")

if __name__ == "__main__":
    # Set your OpenAI API key for testing
    os.environ["OPENAI_API_KEY"] = "your_openai_api_key_here"
    
    asyncio.run(test_ai_features())
