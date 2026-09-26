"""
Learning from Tom's corrections.

Every edit, send-back and piece of feedback is stored as a lesson. The most
recent active lessons go to every agent, so a correction made once is not
needed twice. Tom can switch a lesson off in the Agent team tab.
"""
import datetime as dt
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from .models import AgentAction, AgentEvent, AgentLesson

CLIP = 700  # characters of before/after text shown to agents per lesson


def _clip(text: str) -> str:
    text = text or ""
    return text if len(text) <= CLIP else text[:CLIP] + " ..."


def record(db: Session, source: str, *, task_title: str = "", action_kind: str = None,
           before: str = "", after: str = "", note: str = "") -> AgentLesson:
    lesson = AgentLesson(source=source, task_title=task_title or "", action_kind=action_kind,
                         before=before or "", after=after or "", note=note or "", active=True)
    db.add(lesson)
    return lesson


def for_context(db: Session, limit: int) -> List[Dict[str, Any]]:
    """What the agents see: newest first, each short enough to keep prompts lean."""
    if not limit:
        return []
    rows = (db.query(AgentLesson).filter(AgentLesson.active.is_(True))
            .order_by(AgentLesson.created_at.desc()).limit(limit).all())
    out = []
    for r in rows:
        item = {"from": r.source, "on": r.task_title, "kind": r.action_kind}
        if r.note:
            item["tom_said"] = _clip(r.note)
        if r.source == "edit":
            item["agents_wrote"] = _clip(r.before)
            item["tom_changed_it_to"] = _clip(r.after)
        out.append(item)
    return out


def stats(db: Session, months: int = 3) -> List[Dict[str, Any]]:
    """Per calendar month: actions delivered, approved as they stood, edited, sent back.

    The trend is the point: if the team is learning, edits and send-backs fall.
    """
    today = dt.date.today()
    buckets = []
    for i in range(months - 1, -1, -1):
        index = today.month - 1 - i
        year, month = today.year + index // 12, index % 12 + 1
        buckets.append({"month": f"{year:04d}-{month:02d}", "delivered": 0, "approved_as_is": 0,
                        "edited": 0, "sent_back": 0})
    by_month = {b["month"]: b for b in buckets}
    edited_ids = set()
    for e in db.query(AgentEvent).filter(AgentEvent.kind == "status", AgentEvent.actor == "tom").all():
        if (e.content or {}).get("edited_action"):
            edited_ids.add(e.content["edited_action"])
    for a in db.query(AgentAction).filter(AgentAction.status != "superseded").all():
        created = a.created_at
        if created is None:
            continue
        key = f"{created.year:04d}-{created.month:02d}"
        b = by_month.get(key)
        if b is None:
            continue
        b["delivered"] += 1
        if a.status == "rejected":
            b["sent_back"] += 1
        elif a.id in edited_ids:
            b["edited"] += 1
        elif a.status in ("approved", "done"):
            b["approved_as_is"] += 1
    return buckets
