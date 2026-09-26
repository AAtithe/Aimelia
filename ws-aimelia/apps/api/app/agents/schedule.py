"""
Time-driven work: routines, deferred tasks, follow-ups on delegated work, and
the rule that old tasks go back through Triage.

Everything here is called from the background loop (runner._cycle) and is safe
to run repeatedly: each step checks what it already did.
"""
import calendar
import datetime as dt
import zoneinfo
from typing import List, Optional

from sqlalchemy.orm import Session

from ..settings import settings
from .models import AgentAction, AgentEvent, AgentRoutine, AgentTask

CADENCES = ("weekly", "fortnightly", "monthly", "quarterly")


def london_today() -> dt.date:
    return dt.datetime.now(zoneinfo.ZoneInfo(settings.TIMEZONE or "Europe/London")).date()


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _aware(value: Optional[dt.datetime]) -> Optional[dt.datetime]:
    """SQLite hands back naive datetimes; treat them as UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"]


def uk_date(d: dt.date) -> str:
    """House date format: 2 Oct 2026."""
    return f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def touch(task: AgentTask) -> None:
    """Record that Tom did something with the task, which resets the old-task clock."""
    task.last_touched_at = utcnow()
    task.stale_nudged_at = None


# ---------------------------------------------------------------- routine dates

def _month_day(year: int, month: int, day_of_month: int) -> dt.date:
    last = calendar.monthrange(year, month)[1]
    day = last if day_of_month == -1 else min(max(day_of_month, 1), last)
    return dt.date(year, month, day)


def _add_months(d: dt.date, months: int, day_of_month: int) -> dt.date:
    index = d.month - 1 + months
    return _month_day(d.year + index // 12, index % 12 + 1, day_of_month)


def first_due(cadence: str, weekday: int, day_of_month: int, today: dt.date) -> dt.date:
    """The first occurrence on or after today."""
    if cadence in ("weekly", "fortnightly"):
        return today + dt.timedelta(days=(weekday - today.weekday()) % 7)
    candidate = _month_day(today.year, today.month, day_of_month)
    if candidate < today:
        candidate = _add_months(candidate, 1, day_of_month)
    return candidate


def next_after(cadence: str, current: dt.date, day_of_month: int) -> dt.date:
    if cadence == "weekly":
        return current + dt.timedelta(days=7)
    if cadence == "fortnightly":
        return current + dt.timedelta(days=14)
    if cadence == "monthly":
        return _add_months(current, 1, day_of_month)
    if cadence == "quarterly":
        return _add_months(current, 3, day_of_month)
    raise ValueError(f"Unknown cadence {cadence}")


def create_due_routines(db: Session, today: Optional[dt.date] = None) -> List[AgentTask]:
    """Create the task for any routine whose next occurrence is within its lead time.

    Occurrences already missed (the routine was off, or the server was down) are
    skipped rather than stacked up: a lapsed weekly routine creates one task, not a backlog.
    """
    today = today or london_today()
    made = []
    for r in db.query(AgentRoutine).filter(AgentRoutine.enabled.is_(True)).all():
        dom = r.day_of_month if r.day_of_month is not None else 1
        lead = dt.timedelta(days=r.lead_days or 0)
        due = dt.date.fromisoformat(r.next_due)
        if due - lead > today:
            continue
        while due < today:
            following = next_after(r.cadence, due, dom)
            if following - lead > today:
                break
            due = following
        task = AgentTask(title=r.title, notes=r.notes or "", priority=r.priority or 2,
                         due_date=due.isoformat(), status="queued", kind="routine", routine_id=r.id)
        task.events.append(AgentEvent(kind="status", actor="routine",
                                      content={"status": "queued", "reason": f"{r.cadence} routine due {uk_date(due)}"}))
        db.add(task)
        made.append(task)
        r.created_count = (r.created_count or 0) + 1
        r.next_due = next_after(r.cadence, due, dom).isoformat()
    db.commit()
    return made


# ---------------------------------------------------------------- scheduled and follow-ups

def schedule_follow_up(db: Session, task: AgentTask, action: AgentAction, today: Optional[dt.date] = None) -> AgentTask:
    """After a handover is approved, park a check-in for its due date."""
    today = today or london_today()
    details = action.details or {}
    owner = details.get("owner") or "the owner"
    try:
        due = dt.date.fromisoformat(str(details.get("due")))
    except ValueError:
        due = today + dt.timedelta(days=7)
    follow = AgentTask(
        title=f"Check {owner} delivered: {task.title}"[:500],
        notes=f"Handed to {owner} on {uk_date(today)}, due back {uk_date(due)}.\n\nHandover sent:\n{action.content}",
        priority=task.priority or 2, due_date=due.isoformat(), scheduled_for=due.isoformat(),
        status="scheduled", kind="follow_up", parent_id=task.id,
        follow_up={"owner": owner, "action_id": action.id, "handover": action.content},
    )
    db.add(follow)
    follow.events.append(AgentEvent(kind="status", actor="aimelia",
                                    content={"status": "scheduled", "reason": f"follow-up on {uk_date(due)}"}))
    return follow


def defer(task: AgentTask, until: dt.date, reason: str) -> None:
    task.status = "scheduled"
    task.scheduled_for = until.isoformat()
    task.events.append(AgentEvent(kind="status", actor="tom",
                                  content={"status": "scheduled", "reason": f"deferred to {uk_date(until)}. {reason}".strip()}))


def wake_scheduled(db: Session, today: Optional[dt.date] = None) -> int:
    """Scheduled tasks whose date has come: follow-ups become due, everything else is queued."""
    today = (today or london_today()).isoformat()
    woken = db.query(AgentTask).filter(AgentTask.status == "scheduled", AgentTask.scheduled_for <= today).all()
    for t in woken:
        t.status = "due" if t.kind == "follow_up" else "queued"
        t.events.append(AgentEvent(kind="status", actor="aimelia", content={"status": t.status, "reason": "its date has come"}))
    db.commit()
    return len(woken)


def nudge_stale(db: Session, stale_days: int, now: Optional[dt.datetime] = None) -> int:
    """Tasks nobody has touched for stale_days go back through Triage, told to delegate or drop."""
    if not stale_days or stale_days <= 0:
        return 0
    now = now or utcnow()
    cutoff = now - dt.timedelta(days=stale_days)
    count = 0
    for t in db.query(AgentTask).filter(AgentTask.status.in_(["ready", "needs_input", "failed"])).all():
        last = _aware(t.last_touched_at) or _aware(t.created_at) or now
        nudged = _aware(t.stale_nudged_at)
        if last > cutoff or (nudged and nudged > cutoff):
            continue
        days = (now - last).days
        t.events.append(AgentEvent(kind="feedback", actor="aimelia", content={"text": (
            f"This task has sat untouched for {days} days. Treat that as evidence it is not Tom's to do. "
            "Triage: the verdict must be DELEGATE or DROP unless there is a hard reason only Tom can do it, and say that reason.")}))
        for q in t.questions:
            if q.status == "open":
                q.status = "dismissed"
        t.stale_nudged_at = now
        t.status = "queued"
        count += 1
    db.commit()
    return count
