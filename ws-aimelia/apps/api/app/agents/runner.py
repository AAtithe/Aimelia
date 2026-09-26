"""
Background loop that keeps the agent team working while Tom is away.

Runs inside the API process (AGENT_LOOP_IN_API=true) and/or the scheduler
worker. Claims are atomic, so running both never double-processes a task.
"""
import asyncio
import logging
import time

from ..db import SessionLocal
from . import notify, orchestrator, schedule

logger = logging.getLogger(__name__)


_last_queue_run = 0.0


def _cycle() -> int:
    global _last_queue_run
    db = SessionLocal()
    try:
        orchestrator.seed_defaults(db)
        orchestrator.release_stale(db)
        pipeline = orchestrator.get_pipeline(db)
        auto_run, interval = pipeline.auto_run, pipeline.run_interval_minutes
        # Time-driven work first, so anything it queues is picked up in this same cycle.
        for step in (lambda: schedule.wake_scheduled(db),
                     lambda: schedule.create_due_routines(db),
                     lambda: schedule.nudge_stale(db, pipeline.stale_days if pipeline.stale_days is not None else 14)):
            try:
                step()
            except Exception:
                db.rollback()
                logger.exception("Scheduled step failed")
    finally:
        db.close()
    processed = 0
    if auto_run and time.monotonic() - _last_queue_run >= max(interval or 10, 1) * 60 - 5:
        _last_queue_run = time.monotonic()
        processed = orchestrator.process_queue()
    if processed:
        logger.info("Agent team processed %s task(s)", processed)
    # The morning push goes after the queue has run, so it reports this morning's finished work.
    db = SessionLocal()
    try:
        notify.maybe_send_morning(db, orchestrator.get_pipeline(db))
    except Exception:
        logger.exception("Morning brief failed")
    finally:
        db.close()
    return interval


async def agent_loop():
    logger.info("Agent loop started")
    while True:
        interval = 10
        try:
            interval = await asyncio.to_thread(_cycle)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Agent loop cycle failed")
        # Wake at least every 10 minutes so the morning push is not late when the queue interval is long.
        await asyncio.sleep(min(max(interval or 10, 1), 10) * 60)
