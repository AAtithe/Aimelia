"""
Morning push: what needs Tom today, sent to Teams and/or his phone. Never email.

Channels (set on the server, all optional):
  TEAMS_WEBHOOK_URL  a Teams Workflows "When a Teams webhook request is received" URL
  NTFY_URL           an ntfy topic URL, e.g. https://ntfy.sh/<long-random-topic>, for phone push
  NTFY_TOKEN         access token if the ntfy topic is protected
  AIMELIA_APP_URL    where the buttons link to (the /tasks page)
"""
import datetime as dt
import logging
import zoneinfo
from typing import Any, Dict, List

import httpx
from sqlalchemy.orm import Session

from ..settings import settings
from .models import AgentAction, AgentQuestion, AgentTask

logger = logging.getLogger(__name__)


def channels() -> Dict[str, bool]:
    return {"teams": bool(settings.TEAMS_WEBHOOK_URL), "phone": bool(settings.NTFY_URL)}


def build_brief(db: Session) -> Dict[str, Any]:
    questions = (db.query(AgentQuestion).join(AgentTask)
                 .filter(AgentQuestion.status == "open", AgentTask.status == "needs_input").all())
    actions = (db.query(AgentAction).join(AgentTask)
               .filter(AgentAction.status == "proposed", AgentTask.status == "ready")
               .order_by(AgentTask.priority).all())
    follow_ups = db.query(AgentTask).filter(AgentTask.status == "due").all()
    today = dt.date.today().isoformat()
    overdue = (db.query(AgentTask).filter(AgentTask.status.notin_(["done", "scheduled"]),
                                          AgentTask.due_date.isnot(None), AgentTask.due_date < today).count())
    parts = []
    if questions:
        parts.append(f"{len(questions)} question{'s' if len(questions) != 1 else ''} to answer")
    if actions:
        parts.append(f"{len(actions)} ready to approve")
    if follow_ups:
        parts.append(f"{len(follow_ups)} follow-up{'s' if len(follow_ups) != 1 else ''} due")
    if overdue:
        parts.append(f"{overdue} past its due date" if overdue == 1 else f"{overdue} past their due date")
    headline = ", ".join(parts) if parts else "Nothing needs you this morning"
    lines: List[str] = []
    for q in questions[:3]:
        lines.append(f"Answer: {q.question} ({q.task.title})")
    for f in follow_ups[:3]:
        lines.append(f"Follow up: {f.title}")
    for a in actions[:4]:
        lines.append(f"Approve: {a.title}")
    return {"headline": headline, "lines": lines, "empty": not parts,
            "counts": {"questions": len(questions), "actions": len(actions), "follow_ups": len(follow_ups),
                       "overdue": overdue}}


def _teams_payload(brief: Dict[str, Any]) -> Dict[str, Any]:
    body = [
        {"type": "TextBlock", "text": "Agent Tasks: this morning", "weight": "Bolder", "size": "Medium", "color": "Accent"},
        {"type": "TextBlock", "text": brief["headline"], "wrap": True},
    ] + [{"type": "TextBlock", "text": f"- {line}", "wrap": True, "spacing": "Small"} for line in brief["lines"]]
    card = {"type": "AdaptiveCard", "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "version": "1.4", "body": body,
            "actions": [{"type": "Action.OpenUrl", "title": "Open Agent Tasks", "url": settings.AIMELIA_APP_URL}]}
    return {"type": "message", "attachments": [
        {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": card}]}


def send(brief: Dict[str, Any]) -> Dict[str, str]:
    """Send to every configured channel. Returns per-channel outcome; never raises."""
    results: Dict[str, str] = {}
    if settings.TEAMS_WEBHOOK_URL:
        try:
            r = httpx.post(settings.TEAMS_WEBHOOK_URL, json=_teams_payload(brief), timeout=20)
            results["teams"] = "sent" if r.status_code < 300 else f"failed: HTTP {r.status_code}"
        except httpx.HTTPError as e:
            results["teams"] = f"failed: {e}"
    if settings.NTFY_URL:
        headers = {"Title": "Agent Tasks", "Click": settings.AIMELIA_APP_URL, "Tags": "clipboard"}
        if settings.NTFY_TOKEN:
            headers["Authorization"] = f"Bearer {settings.NTFY_TOKEN}"
        text = "\n".join([brief["headline"]] + brief["lines"])
        try:
            r = httpx.post(settings.NTFY_URL, content=text.encode("utf-8"), headers=headers, timeout=20)
            results["phone"] = "sent" if r.status_code < 300 else f"failed: HTTP {r.status_code}"
        except httpx.HTTPError as e:
            results["phone"] = f"failed: {e}"
    if not results:
        results["none"] = "No channel is set up. Set TEAMS_WEBHOOK_URL or NTFY_URL on the server."
    return results


def due_now(pipeline, now: dt.datetime = None) -> bool:
    """Is it time for today's push and has it not gone yet?"""
    if not pipeline.brief_enabled:
        return False
    now = now or dt.datetime.now(zoneinfo.ZoneInfo(settings.TIMEZONE or "Europe/London"))
    if now.weekday() >= 5 and not pipeline.brief_weekends:
        return False
    if pipeline.last_brief_date == now.date().isoformat():
        return False
    return now.strftime("%H:%M") >= (pipeline.brief_time or "07:30")


def maybe_send_morning(db: Session, pipeline, now: dt.datetime = None) -> Dict[str, str]:
    now = now or dt.datetime.now(zoneinfo.ZoneInfo(settings.TIMEZONE or "Europe/London"))
    if not due_now(pipeline, now):
        return {}
    brief = build_brief(db)
    results = send(brief)
    pipeline.last_brief_date = now.date().isoformat()
    db.commit()
    logger.info("Morning brief: %s", results)
    return results
