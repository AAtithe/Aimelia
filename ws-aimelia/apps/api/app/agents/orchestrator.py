"""
The agent team's run loop.

For each queued task:
  1. Worker agents run in order. Each sees the task, Tom's answers, the draft
     actions so far and any reviewer feedback, and returns an updated draft.
  2. If any agent is blocked it raises questions; the task pauses as
     `needs_input` until Tom answers.
  3. Reviewer agents score the draft. Below the threshold, the draft goes back
     to the workers with the feedback, up to `max_revisions` times.
  4. The final draft is saved as proposed actions and the task becomes `ready`.
     If the reviewer never approved, the actions are saved but flagged.
"""
import datetime as dt
import logging
import time
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..db import SessionLocal
from . import llm
from .defaults import (CAPTURE_PROMPT, DEFAULT_AGENTS, DEFAULT_HOUSE_RULES, DEFAULTS_VERSION,
                       REVIEWER_CONTRACT, WORKER_CONTRACT, WORKER_CONTRACT_NO_QUESTIONS)
from .models import (AgentAction, AgentConfig, AgentEvent, AgentPipelineSettings,
                     AgentQuestion, AgentTask)

logger = logging.getLogger(__name__)

ACTION_KINDS = {"email_draft", "document", "checklist", "decision", "call", "delegate", "note"}


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# ---------------------------------------------------------------- setup

def seed_defaults(db: Session, force: bool = False) -> None:
    """Create the default team and settings, and offer default agents added since the last visit."""
    if force:
        db.query(AgentConfig).delete()
    pipeline = db.get(AgentPipelineSettings, 1)
    if pipeline is None:
        pipeline = AgentPipelineSettings(id=1, house_rules=DEFAULT_HOUSE_RULES, defaults_version=0)
        db.add(pipeline)
    seen = 0 if force else (pipeline.defaults_version or 0)
    fresh = force or db.query(AgentConfig).count() == 0
    if fresh or seen < DEFAULTS_VERSION:
        names = {a.name for a in db.query(AgentConfig).all()}
        lowest = min([a.position for a in db.query(AgentConfig).filter(AgentConfig.role == "worker")], default=0)
        for spec in DEFAULT_AGENTS:
            spec = dict(spec)
            since = spec.pop("since", 0)
            if spec["name"] in names or (not fresh and since <= seen):
                continue
            if not fresh:  # joining an existing team: put it first rather than clash on position
                spec["position"] = lowest - 1
            db.add(AgentConfig(**{"enabled": True, **spec}))
        pipeline.defaults_version = DEFAULTS_VERSION
    db.commit()


def get_pipeline(db: Session) -> AgentPipelineSettings:
    pipeline = db.get(AgentPipelineSettings, 1)
    if pipeline is None:
        seed_defaults(db)
        pipeline = db.get(AgentPipelineSettings, 1)
    return pipeline


def team(db: Session, role: str) -> List[AgentConfig]:
    return (db.query(AgentConfig)
            .filter(AgentConfig.role == role, AgentConfig.enabled.is_(True))
            .order_by(AgentConfig.position, AgentConfig.created_at)
            .all())


# ---------------------------------------------------------------- helpers

def log_event(db: Session, task: AgentTask, kind: str, actor: str, content: Dict[str, Any], attempt: int = 0):
    task.events.append(AgentEvent(kind=kind, actor=actor, attempt=attempt, content=content))


def _clean_actions(raw: Any) -> Optional[List[Dict[str, Any]]]:
    if raw is None or not isinstance(raw, list):
        return None
    cleaned = []
    for item in raw:
        if not isinstance(item, dict) or not item.get("title"):
            continue
        kind = str(item.get("kind") or "note").lower()
        details = item.get("details") if isinstance(item.get("details"), dict) else {}
        cleaned.append({
            "kind": kind if kind in ACTION_KINDS else "note",
            "title": str(item["title"])[:500],
            "content": str(item.get("content") or ""),
            "details": details,
        })
    return cleaned


def _clean_questions(raw: Any) -> List[Dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out = []
    for q in raw:
        if isinstance(q, str) and q.strip():
            out.append({"question": q.strip(), "why": ""})
        elif isinstance(q, dict) and str(q.get("question") or "").strip():
            out.append({"question": str(q["question"]).strip(), "why": str(q.get("why") or "")})
    return out


def build_context(task: AgentTask, team_directory: str = "") -> Dict[str, Any]:
    """What every agent sees about the task."""
    answered = [{"question": q.question, "answer": q.answer}
                for q in task.questions if q.status == "answered"]
    dismissed = [q.question for q in task.questions if q.status == "dismissed"]
    feedback = [e.content.get("text") for e in task.events if e.kind == "feedback" and e.content]
    previous = [{"title": a.title, "kind": a.kind, "status": a.status, "tom_feedback": a.user_feedback}
                for a in task.actions if a.status in ("rejected", "approved", "done")]
    return {
        "task": {"title": task.title, "notes": task.notes or "", "priority": task.priority,
                 "due_date": task.due_date, "today": dt.date.today().isoformat()},
        "answered_questions": answered,
        "questions_tom_declined": dismissed,
        "tom_feedback": feedback,
        "previous_actions": previous,
        "team_directory": team_directory or "(not filled in yet: name roles rather than people)",
    }


def _system_prompt(agent: AgentConfig, house_rules: str, contract: str) -> str:
    return f"{agent.instructions.strip()}\n\nHouse rules:\n{house_rules.strip()}\n{contract}"


# ---------------------------------------------------------------- the run

def run_task(db: Session, task: AgentTask) -> str:
    """Run the full team on one task. Returns the task's final status."""
    pipeline = get_pipeline(db)
    workers, reviewers = team(db, "worker"), team(db, "reviewer")
    if not workers:
        raise llm.LLMError("No enabled worker agents. Enable or add one in Agent team.")

    task.run_count = (task.run_count or 0) + 1
    task.last_run_at = now()
    context = build_context(task, pipeline.team_directory or "")
    draft: List[Dict[str, Any]] = []
    reviewer_feedback: Optional[Dict[str, Any]] = None
    last_review: Dict[str, Any] = {}
    approved = not reviewers

    for attempt in range(pipeline.max_revisions + 1):
        # 1. workers
        for agent in workers:
            payload = {**context, "draft_actions": draft, "reviewer_feedback": reviewer_feedback,
                       "attempt": attempt, "can_ask_questions": agent.can_ask_questions,
                       "you_are": agent.name}
            contract = WORKER_CONTRACT if agent.can_ask_questions else WORKER_CONTRACT_NO_QUESTIONS
            started = time.monotonic()
            reply = llm.complete_json(provider=agent.provider, model=agent.model, role="worker",
                                      system=_system_prompt(agent, pipeline.house_rules or "", contract),
                                      payload=payload, temperature=agent.temperature)
            actions = _clean_actions(reply.get("actions"))
            if actions is not None:
                draft = actions
            if reply.get("summary"):
                task.summary = str(reply["summary"])
            log_event(db, task, "worker", agent.name, {
                "summary": reply.get("summary"), "actions": actions,
                "seconds": round(time.monotonic() - started, 1)}, attempt)

            questions = _clean_questions(reply.get("questions")) if agent.can_ask_questions else []
            if questions:
                return _pause_for_input(db, task, agent.name, questions, pipeline.max_questions_per_run, attempt)

        # 2. reviewers
        if not reviewers:
            break
        verdicts = []
        for agent in reviewers:
            contract = REVIEWER_CONTRACT if agent.can_ask_questions else \
                REVIEWER_CONTRACT.replace('"questions": [ {"question": "...", "why": "..."} ]', '"questions": []')
            reply = llm.complete_json(provider=agent.provider, model=agent.model, role="reviewer",
                                      system=_system_prompt(agent, pipeline.house_rules or "", contract),
                                      payload={**context, "draft_actions": draft, "attempt": attempt,
                                               "approval_threshold": pipeline.approval_threshold,
                                               "can_ask_questions": agent.can_ask_questions},
                                      temperature=agent.temperature)
            try:
                score = float(reply.get("score", 0))
            except (TypeError, ValueError):
                score = 0.0
            ok = str(reply.get("verdict", "")).lower() == "approve" and score >= pipeline.approval_threshold
            verdict = {"reviewer": agent.name, "approved": ok, "score": score,
                       "feedback": reply.get("feedback") or "", "action_feedback": reply.get("action_feedback") or []}
            verdicts.append(verdict)
            log_event(db, task, "review", agent.name, verdict, attempt)

            questions = _clean_questions(reply.get("questions")) if agent.can_ask_questions else []
            if questions:
                return _pause_for_input(db, task, agent.name, questions, pipeline.max_questions_per_run, attempt)

        last_review = {"score": min(v["score"] for v in verdicts),
                       "notes": "\n".join(f"{v['reviewer']}: {v['feedback']}" for v in verdicts if v["feedback"]),
                       "action_feedback": [f for v in verdicts for f in v["action_feedback"]]}
        if all(v["approved"] for v in verdicts):
            approved = True
            break
        reviewer_feedback = {"attempt": attempt, "reviews": verdicts}

    return _save_actions(db, task, draft, approved, last_review, pipeline.max_revisions)


def _pause_for_input(db: Session, task: AgentTask, asked_by: str, questions: List[Dict[str, str]],
                     limit: int, attempt: int) -> str:
    already = {q.question.strip().lower() for q in task.questions}
    for q in questions[:max(limit, 1)]:
        if q["question"].strip().lower() in already:
            continue
        task.questions.append(AgentQuestion(asked_by=asked_by, question=q["question"], why=q["why"], status="open"))
    log_event(db, task, "question", asked_by, {"questions": questions[:limit]}, attempt)
    if not any(q.status == "open" for q in task.questions):
        # Every question was a repeat: do not loop forever, flag it instead.
        task.status = "failed"
        log_event(db, task, "error", "orchestrator",
                  {"error": "Agents repeated questions that were already answered or dismissed. Add notes and re-run."})
        return task.status
    task.status = "needs_input"
    return task.status


def _save_actions(db: Session, task: AgentTask, draft: List[Dict[str, Any]], approved: bool,
                  review: Dict[str, Any], max_revisions: int) -> str:
    # Older proposals that Tom has not acted on are replaced by the new draft.
    for old in task.actions:
        if old.status == "proposed":
            old.status = "superseded"
    start = max([a.position for a in task.actions], default=-1) + 1
    notes_by_index = {}
    for f in review.get("action_feedback", []):
        if isinstance(f, dict) and isinstance(f.get("index"), int):
            notes_by_index.setdefault(f["index"], []).append(str(f.get("note") or ""))
    for i, item in enumerate(draft):
        task.actions.append(AgentAction(position=start + i, status="proposed", kind=item["kind"], title=item["title"],
                           content=item["content"], details=item["details"],
                           review_status="approved" if approved else "flagged",
                           review_score=review.get("score"),
                           review_notes="\n".join(filter(None, [review.get("notes", "")] + notes_by_index.get(i, [])))))
    task.review_flag = None if approved else (
        f"Reviewer did not approve after {max_revisions + 1} attempts. Check before using. "
        + (review.get("notes") or ""))
    task.status = "ready" if draft else "failed"
    if not draft:
        log_event(db, task, "error", "orchestrator", {"error": "Agents produced no actions."})
    log_event(db, task, "status", "orchestrator", {"status": task.status, "approved": approved,
                                                   "actions": len(draft)})
    return task.status


# ---------------------------------------------------------------- capture

def split_capture(db: Session, text: str) -> List[Dict[str, Any]]:
    """Turn a free-text brain dump into separate tasks."""
    pipeline = get_pipeline(db)
    reply = llm.complete_json(provider="auto", model=None, role="capture",
                              system=f"{CAPTURE_PROMPT}\n\nHouse rules:\n{pipeline.house_rules or ''}",
                              payload={"brain_dump": text, "today": dt.date.today().isoformat()},
                              temperature=0.2)
    tasks = []
    for t in reply.get("tasks") or []:
        if not isinstance(t, dict) or not str(t.get("title") or "").strip():
            continue
        try:
            priority = min(max(int(t.get("priority") or 2), 1), 3)
        except (TypeError, ValueError):
            priority = 2
        due = t.get("due_date")
        due = due if isinstance(due, str) and len(due) == 10 else None
        tasks.append({"title": str(t["title"]).strip()[:500], "notes": str(t.get("notes") or ""),
                      "priority": priority, "due_date": due})
    return tasks


# ---------------------------------------------------------------- queue

def claim_next(db: Session) -> Optional[AgentTask]:
    """Atomically move one queued task to processing so two runners never double up."""
    candidate = (db.query(AgentTask).filter(AgentTask.status == "queued")
                 .order_by(AgentTask.priority, AgentTask.created_at).first())
    if candidate is None:
        return None
    claimed = (db.query(AgentTask)
               .filter(AgentTask.id == candidate.id, AgentTask.status == "queued")
               .update({"status": "processing"}, synchronize_session=False))
    db.commit()
    if not claimed:
        return None
    db.refresh(candidate)
    return candidate


def process_one(task_id: str) -> None:
    """Run one already-claimed task in its own session, recording failures on the task."""
    db = SessionLocal()
    try:
        task = db.get(AgentTask, task_id)
        if task is None:
            return
        try:
            run_task(db, task)
            db.commit()
        except Exception as e:  # noqa: BLE001 - any failure must land on the task, not kill the loop
            db.rollback()
            task = db.get(AgentTask, task_id)
            task.status = "failed"
            log_event(db, task, "error", "orchestrator", {"error": str(e)[:2000]})
            db.commit()
            logger.exception("Agent run failed for task %s", task_id)
    finally:
        db.close()


def release_stale(db: Session, minutes: int = 30) -> int:
    """Tasks stuck in processing (runner crashed) go back to the queue."""
    cutoff = now() - dt.timedelta(minutes=minutes)
    stale = (db.query(AgentTask)
             .filter(AgentTask.status == "processing", AgentTask.updated_at < cutoff).all())
    for t in stale:
        t.status = "queued"
    db.commit()
    return len(stale)


def process_queue(limit: int = 20) -> int:
    """Work through queued tasks. Returns how many were processed."""
    done = 0
    while done < limit:
        db = SessionLocal()
        try:
            task = claim_next(db)
            task_id = task.id if task else None
        finally:
            db.close()
        if task_id is None:
            break
        process_one(task_id)
        done += 1
    return done
