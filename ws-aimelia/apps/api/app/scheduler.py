import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import zoneinfo

TZ = zoneinfo.ZoneInfo("Europe/London")

async def job_hourly_triage():
    # TODO: call triage pipeline
    print("[Aimelia] Hourly triage run")

async def job_daily_digest():
    print("[Aimelia] 08:00 daily digest")

async def job_briefs():
    print("[Aimelia] Briefs for next 24h")

async def main():
    scheduler = AsyncIOScheduler(timezone=TZ)
    scheduler.add_job(job_hourly_triage, CronTrigger(minute=0))
    scheduler.add_job(job_briefs, CronTrigger(hour="6,18", minute=0))
    scheduler.add_job(job_daily_digest, CronTrigger(hour=8, minute=0))
    scheduler.start()
    print("Aimelia scheduler started")
    while True:
        await asyncio.sleep(3600)

if __name__ == "__main__":
    asyncio.run(main())