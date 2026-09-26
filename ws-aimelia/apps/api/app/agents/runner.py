"""
Background loop that keeps the agent team working while Tom is away.

Runs inside the API process (AGENT_LOOP_IN_API=true) and/or the scheduler
worker. Claims are atomic, so running both never double-processes a task.
"""
import asyncio
import logging

from ..db import SessionLocal
from . import orchestrator

logger = logging.getLogger(__name__)


def _cycle() -> int:
    db = SessionLocal()
    try:
        orchestrator.seed_defaults(db)
        orchestrator.release_stale(db)
        pipeline = orchestrator.get_pipeline(db)
        auto_run, interval = pipeline.auto_run, pipeline.run_interval_minutes
    finally:
        db.close()
    processed = orchestrator.process_queue() if auto_run else 0
    if processed:
        logger.info("Agent team processed %s task(s)", processed)
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
        await asyncio.sleep(max(interval, 1) * 60)
