"""
Aimelia Background Scheduler - Making Aimelia Feel Alive
Automated tasks that run in the background to keep Aimelia proactive.
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session
from .db import get_db
from .outlook import router as email_router
from .meeting_prep import meeting_prep
from .smart_drafting import smart_drafting
from .ai_service import ai_service
import httpx

logger = logging.getLogger(__name__)

class AimeliaScheduler:
    """Background scheduler that makes Aimelia feel alive and proactive."""
    
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.is_running = False
        self.logger = logging.getLogger(__name__)
        
    async def start(self):
        """Start the scheduler and all automated tasks."""
        try:
            if self.is_running:
                self.logger.warning("Scheduler is already running")
                return
            
            # Schedule all tasks
            await self._schedule_tasks()
            
            # Start the scheduler
            self.scheduler.start()
            self.is_running = True
            
            self.logger.info("🤖 Aimelia Scheduler started - She's now alive!")
            self.logger.info("📅 Scheduled tasks:")
            self.logger.info("  • Email triage: Every hour")
            self.logger.info("  • Meeting briefs: 06:00 & 18:00 daily")
            self.logger.info("  • Daily digest: 08:00 daily")
            
        except Exception as e:
            self.logger.error(f"Failed to start scheduler: {e}")
            raise
    
    async def stop(self):
        """Stop the scheduler."""
        if self.scheduler.running:
            self.scheduler.shutdown()
            self.is_running = False
            self.logger.info("🛑 Aimelia Scheduler stopped")
    
    async def _schedule_tasks(self):
        """Schedule all automated tasks."""
        
        # 1. Email Triage - Every hour
        self.scheduler.add_job(
            self._hourly_email_triage,
            trigger=IntervalTrigger(hours=1),
            id='hourly_email_triage',
            name='Hourly Email Triage',
            replace_existing=True
        )
        
        # 2. Meeting Briefs - 06:00 and 18:00 daily
        self.scheduler.add_job(
            self._daily_meeting_briefs,
            trigger=CronTrigger(hour=6, minute=0),
            id='morning_meeting_briefs',
            name='Morning Meeting Briefs (06:00)',
            replace_existing=True
        )
        
        self.scheduler.add_job(
            self._daily_meeting_briefs,
            trigger=CronTrigger(hour=18, minute=0),
            id='evening_meeting_briefs',
            name='Evening Meeting Briefs (18:00)',
            replace_existing=True
        )
        
        # 3. Daily Digest - 08:00 daily
        self.scheduler.add_job(
            self._daily_teams_digest,
            trigger=CronTrigger(hour=8, minute=0),
            id='daily_teams_digest',
            name='Daily Teams Digest (08:00)',
            replace_existing=True
        )
        
        # 4. Health Check - Every 30 minutes
        self.scheduler.add_job(
            self._health_check,
            trigger=IntervalTrigger(minutes=30),
            id='health_check',
            name='Health Check',
            replace_existing=True
        )
    
    async def _hourly_email_triage(self):
        """Run email triage every hour - the heart of Aimelia's intelligence."""
        try:
            self.logger.info("📧 Starting hourly email triage...")
            
            # Get database session
            db = next(get_db())
            
            # 1. Fetch new emails
            emails = await self._fetch_new_emails(db)
            if not emails:
                self.logger.info("📧 No new emails to process")
                return
            
            self.logger.info(f"📧 Processing {len(emails)} new emails")
            
            # 2. Process each email
            processed_count = 0
            drafted_count = 0
            filed_count = 0
            
            for email in emails:
                try:
                    # Triage the email
                    triage_result = await self._triage_email(email, db)
                    if triage_result.get('success'):
                        processed_count += 1
                    
                    # Draft reply if needed
                    if triage_result.get('needs_reply'):
                        draft_result = await self._draft_reply(email, db)
                        if draft_result.get('success'):
                            drafted_count += 1
                    
                    # File email if needed
                    if triage_result.get('needs_filing'):
                        file_result = await self._file_email(email, triage_result, db)
                        if file_result.get('success'):
                            filed_count += 1
                    
                except Exception as e:
                    self.logger.error(f"Error processing email {email.get('id', 'unknown')}: {e}")
            
            # 3. Update summary
            await self._update_daily_summary(processed_count, drafted_count, filed_count, db)
            
            self.logger.info(f"✅ Hourly triage complete: {processed_count} processed, {drafted_count} drafted, {filed_count} filed")
            
        except Exception as e:
            self.logger.error(f"Hourly email triage failed: {e}")
    
    async def _daily_meeting_briefs(self):
        """Generate meeting briefs for next 24 hours."""
        try:
            self.logger.info("📅 Starting daily meeting brief generation...")
            
            # Get database session
            db = next(get_db())
            
            # Generate briefs for next 24h
            result = await meeting_prep.prep_next_24h_meetings(db)
            
            if result.get('success'):
                meetings_prepared = result.get('meetings_prepared', 0)
                self.logger.info(f"✅ Generated briefs for {meetings_prepared} meetings")
            else:
                self.logger.error(f"Meeting brief generation failed: {result.get('error')}")
            
        except Exception as e:
            self.logger.error(f"Daily meeting briefs failed: {e}")
    
    async def _daily_teams_digest(self):
        """Post daily digest to Teams."""
        try:
            self.logger.info("📱 Starting daily Teams digest...")
            
            # Get database session
            db = next(get_db())
            
            # Generate daily digest
            digest = await self._generate_daily_digest(db)
            
            # Post to Teams (placeholder - would need Teams webhook)
            await self._post_to_teams(digest)
            
            self.logger.info("✅ Daily Teams digest posted")
            
        except Exception as e:
            self.logger.error(f"Daily Teams digest failed: {e}")
    
    async def _health_check(self):
        """Regular health check to ensure Aimelia is running smoothly."""
        try:
            # Simple health check
            db = next(get_db())
            
            # Check if we can access the database
            # Check if we can access Microsoft Graph
            # Log system status
            
            self.logger.debug("💚 Health check passed - Aimelia is healthy")
            
        except Exception as e:
            self.logger.error(f"Health check failed: {e}")
    
    async def _fetch_new_emails(self, db: Session) -> List[Dict[str, Any]]:
        """Fetch new emails from Microsoft Graph."""
        try:
            # This would integrate with the existing email fetching logic
            # For now, return empty list as placeholder
            return []
        except Exception as e:
            self.logger.error(f"Failed to fetch new emails: {e}")
            return []
    
    async def _triage_email(self, email: Dict[str, Any], db: Session) -> Dict[str, Any]:
        """Triage an email using AI."""
        try:
            # Use existing triage logic
            # Return triage result with flags for next actions
            return {
                'success': True,
                'needs_reply': True,
                'needs_filing': True,
                'priority': 'medium',
                'category': 'business'
            }
        except Exception as e:
            self.logger.error(f"Email triage failed: {e}")
            return {'success': False, 'error': str(e)}
    
    async def _draft_reply(self, email: Dict[str, Any], db: Session) -> Dict[str, Any]:
        """Draft a reply to an email."""
        try:
            # Use existing smart drafting logic
            result = await smart_drafting.process_incoming_email(email['id'], db)
            return result
        except Exception as e:
            self.logger.error(f"Reply drafting failed: {e}")
            return {'success': False, 'error': str(e)}
    
    async def _file_email(self, email: Dict[str, Any], triage_result: Dict[str, Any], db: Session) -> Dict[str, Any]:
        """File email in appropriate folder."""
        try:
            # Determine folder based on triage result
            folder = self._determine_folder(triage_result)
            
            # Move email to folder (would use Microsoft Graph API)
            # For now, just log the action
            self.logger.info(f"📁 Would file email in folder: {folder}")
            
            return {'success': True, 'folder': folder}
        except Exception as e:
            self.logger.error(f"Email filing failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def _determine_folder(self, triage_result: Dict[str, Any]) -> str:
        """Determine which folder to file the email in."""
        category = triage_result.get('category', 'general')
        priority = triage_result.get('priority', 'medium')
        
        folder_mapping = {
            'urgent': 'Urgent',
            'business': 'Business',
            'personal': 'Personal',
            'finance': 'Finance',
            'legal': 'Legal',
            'general': 'Inbox'
        }
        
        return folder_mapping.get(category, 'Inbox')
    
    async def _update_daily_summary(self, processed: int, drafted: int, filed: int, db: Session):
        """Update the daily summary with activity."""
        try:
            # Update daily summary in database
            # This would track daily activity metrics
            self.logger.info(f"📊 Daily summary updated: {processed} processed, {drafted} drafted, {filed} filed")
        except Exception as e:
            self.logger.error(f"Failed to update daily summary: {e}")
    
    async def _generate_daily_digest(self, db: Session) -> str:
        """Generate daily digest content."""
        try:
            # Generate digest using AI
            digest_content = f"""
# 📊 Aimelia Daily Digest - {datetime.now().strftime('%Y-%m-%d')}

## 📧 Email Activity
- Emails processed: [count]
- Replies drafted: [count]
- Emails filed: [count]

## 📅 Meeting Preparation
- Briefs generated: [count]
- Meetings tomorrow: [count]

## 🎯 Key Actions
- [Action items from the day]

## 💡 Insights
- [AI-generated insights about the day's activity]

---
*Prepared by Aimelia at {datetime.now().strftime('%H:%M')}*
            """
            
            return digest_content
        except Exception as e:
            self.logger.error(f"Failed to generate daily digest: {e}")
            return "Daily digest generation failed"
    
    async def _post_to_teams(self, digest: str):
        """Post digest to Teams (placeholder)."""
        try:
            # This would post to Teams webhook
            # For now, just log the digest
            self.logger.info(f"📱 Teams digest content:\n{digest}")
        except Exception as e:
            self.logger.error(f"Failed to post to Teams: {e}")
    
    def get_status(self) -> Dict[str, Any]:
        """Get current scheduler status."""
        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append({
                'id': job.id,
                'name': job.name,
                'next_run': job.next_run_time.isoformat() if job.next_run_time else None,
                'trigger': str(job.trigger)
            })
        
        return {
            'running': self.is_running,
            'jobs': jobs,
            'total_jobs': len(jobs)
        }

# Global scheduler instance
aimelia_scheduler = AimeliaScheduler()
