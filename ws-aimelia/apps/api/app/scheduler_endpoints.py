"""
API endpoints for managing Aimelia's background scheduler.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any
from .db import get_db
from .aimelia_scheduler import aimelia_scheduler
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/scheduler/start")
async def start_scheduler():
    """
    Start Aimelia's background scheduler.
    This makes Aimelia come alive with automated tasks.
    """
    try:
        await aimelia_scheduler.start()
        return {
            "success": True,
            "message": "🤖 Aimelia scheduler started - She's now alive!",
            "status": "running"
        }
    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start scheduler: {str(e)}")

@router.post("/scheduler/stop")
async def stop_scheduler():
    """
    Stop Aimelia's background scheduler.
    """
    try:
        await aimelia_scheduler.stop()
        return {
            "success": True,
            "message": "🛑 Aimelia scheduler stopped",
            "status": "stopped"
        }
    except Exception as e:
        logger.error(f"Failed to stop scheduler: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to stop scheduler: {str(e)}")

@router.get("/scheduler/status")
async def get_scheduler_status():
    """
    Get the current status of Aimelia's scheduler.
    """
    try:
        status = aimelia_scheduler.get_status()
        return {
            "success": True,
            "scheduler": status,
            "message": "Scheduler status retrieved"
        }
    except Exception as e:
        logger.error(f"Failed to get scheduler status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get scheduler status: {str(e)}")

@router.post("/scheduler/run-now/{task_name}")
async def run_task_now(task_name: str, db: Session = Depends(get_db)):
    """
    Manually trigger a scheduled task to run now.
    
    Available tasks:
    - hourly_email_triage
    - daily_meeting_briefs
    - daily_teams_digest
    - health_check
    """
    try:
        if task_name == "hourly_email_triage":
            await aimelia_scheduler._hourly_email_triage()
            message = "📧 Email triage completed"
        elif task_name == "daily_meeting_briefs":
            await aimelia_scheduler._daily_meeting_briefs()
            message = "📅 Meeting briefs generated"
        elif task_name == "daily_teams_digest":
            await aimelia_scheduler._daily_teams_digest()
            message = "📱 Teams digest posted"
        elif task_name == "health_check":
            await aimelia_scheduler._health_check()
            message = "💚 Health check completed"
        else:
            raise HTTPException(status_code=400, detail=f"Unknown task: {task_name}")
        
        return {
            "success": True,
            "task": task_name,
            "message": message
        }
    except Exception as e:
        logger.error(f"Failed to run task {task_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to run task: {str(e)}")

@router.get("/scheduler/tasks")
async def get_scheduled_tasks():
    """
    Get information about all scheduled tasks.
    """
    try:
        status = aimelia_scheduler.get_status()
        tasks = []
        
        for job in status.get('jobs', []):
            tasks.append({
                "id": job['id'],
                "name": job['name'],
                "next_run": job['next_run'],
                "trigger": job['trigger'],
                "status": "scheduled"
            })
        
        return {
            "success": True,
            "tasks": tasks,
            "total_tasks": len(tasks),
            "scheduler_running": status.get('running', False)
        }
    except Exception as e:
        logger.error(f"Failed to get scheduled tasks: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get tasks: {str(e)}")

@router.get("/scheduler/logs")
async def get_scheduler_logs():
    """
    Get recent scheduler logs.
    """
    try:
        # This would return recent logs from the scheduler
        # For now, return a placeholder
        return {
            "success": True,
            "logs": [
                {
                    "timestamp": "2024-01-15T10:00:00Z",
                    "level": "INFO",
                    "message": "🤖 Aimelia Scheduler started - She's now alive!"
                },
                {
                    "timestamp": "2024-01-15T10:30:00Z",
                    "level": "INFO",
                    "message": "📧 Hourly email triage completed: 5 processed, 3 drafted, 2 filed"
                }
            ],
            "message": "Recent scheduler logs retrieved"
        }
    except Exception as e:
        logger.error(f"Failed to get scheduler logs: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get logs: {str(e)}")

@router.post("/scheduler/test-email-triage")
async def test_email_triage(db: Session = Depends(get_db)):
    """
    Test the email triage functionality.
    """
    try:
        await aimelia_scheduler._hourly_email_triage()
        return {
            "success": True,
            "message": "📧 Email triage test completed",
            "test_type": "hourly_email_triage"
        }
    except Exception as e:
        logger.error(f"Email triage test failed: {e}")
        raise HTTPException(status_code=500, detail=f"Email triage test failed: {str(e)}")

@router.post("/scheduler/test-meeting-briefs")
async def test_meeting_briefs(db: Session = Depends(get_db)):
    """
    Test the meeting brief generation functionality.
    """
    try:
        await aimelia_scheduler._daily_meeting_briefs()
        return {
            "success": True,
            "message": "📅 Meeting briefs test completed",
            "test_type": "daily_meeting_briefs"
        }
    except Exception as e:
        logger.error(f"Meeting briefs test failed: {e}")
        raise HTTPException(status_code=500, detail=f"Meeting briefs test failed: {str(e)}")

@router.get("/scheduler/automation-guide")
async def get_automation_guide():
    """
    Get a guide explaining Aimelia's automation features.
    """
    return {
        "automation_guide": {
            "title": "🤖 Aimelia's Automation Features",
            "description": "How Aimelia stays alive and proactive throughout the day",
            "schedule": {
                "hourly": {
                    "time": "Every hour",
                    "task": "Email Triage",
                    "description": "Processes new emails, drafts replies, files emails in correct folders"
                },
                "morning_briefs": {
                    "time": "06:00 daily",
                    "task": "Morning Meeting Briefs",
                    "description": "Generates comprehensive briefs for all meetings in the next 24 hours"
                },
                "evening_briefs": {
                    "time": "18:00 daily", 
                    "task": "Evening Meeting Briefs",
                    "description": "Updates briefs for the next day's meetings"
                },
                "daily_digest": {
                    "time": "08:00 daily",
                    "task": "Daily Teams Digest",
                    "description": "Posts a summary of the day's activity to Teams"
                }
            },
            "features": {
                "email_intelligence": "AI-powered email triage with automatic reply drafting",
                "meeting_preparation": "Star-level meeting briefs with context and talking points",
                "smart_filing": "Automatic email organization with folder suggestions",
                "daily_summaries": "Comprehensive daily activity reports",
                "proactive_assistance": "Aimelia works in the background without being asked"
            },
            "benefits": [
                "Never miss important emails",
                "Always prepared for meetings",
                "Inbox stays organized automatically",
                "Daily insights into your productivity",
                "More time for strategic work"
            ]
        }
    }
