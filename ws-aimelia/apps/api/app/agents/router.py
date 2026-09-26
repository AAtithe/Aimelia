"""
REST API for the agentic task list, mounted at /todo.

Every endpoint requires the X-Aimelia-Key header to match AIMELIA_ACCESS_KEY.
"""
import datetime as dt
import hmac
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..settings import settings
from . import llm, orchestrator
from .models import (AgentAction, AgentConfig, AgentEvent, AgentQuestion, AgentTask)

logger = logging.getLogger(__name__)


def require_access_key(x_aimelia_key: Optional[str] = Header(default=None)):
    expected = settings.AIMELIA_ACCESS_KEY
    if not expected:
        raise HTTPException(503, "AIMELIA_ACCESS_KEY is not configured on the server.")
    if not x_aimelia_key or not hmac.compare_digest(x_aimelia_key, expected):
        raise HTTPException(401, "Invalid or missing access key.")


router = APIRouter(prefix="/todo", tags=["Agentic Tasks"], dependencies=[Depends(require_access_key)])


# ---------------------------------------------------------------- schemas

class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    notes: str = ""
    priority: int = Field(default=2, ge=1, le=3)
    due_date: Optional[str] = None
    run_now: bool = True


class TaskPatch(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    priority: Optional[int] = Field(default=None, ge=1, le=3)
    due_date: Optional[str] = None
    status: Optional[str] = None


class TextIn(BaseModel):
    text: str = Field(min_length=1)


class AnswerIn(BaseModel):
    answer: str = Field(min_length=1)


class ActionPatch(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class ApproveIn(BaseModel):
    create_outlook_draft: bool = False


class RejectIn(BaseModel):
    reason: str = ""
    rework: bool = True


class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    role: str = Field(default="worker", pattern="^(worker|reviewer)$")
    description: str = ""
    instructions: str = Field(min_length=1)
    provider: str = Field(default="auto", pattern="^(auto|anthropic|openai|mock)$")
    model: Optional[str] = None
    temperature: float = Field(default=0.3, ge=0, le=1)
    position: Optional[int] = None
    enabled: bool = True
    can_ask_questions: bool = True


class AgentPatch(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern="^(worker|reviewer)$")
    description: Optional[str] = None
    instructions: Optional[str] = None
    provider: Optional[str] = Field(default=None, pattern="^(auto|anthropic|openai|mock)$")
    model: Optional[str] = None
    temperature: Optional[float] = Field(default=None, ge=0, le=1)
    position: Optional[int] = None
    enabled: Optional[bool] = None
    can_ask_questions: Optional[bool] = None


class ReorderIn(BaseModel):
    ids: List[str]


class CaptureIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    run_now: bool = True


class PipelinePatch(BaseModel):
    max_revisions: Optional[int] = Field(default=None, ge=0, le=5)
    approval_threshold: Optional[float] = Field(default=None, ge=0, le=10)
    max_questions_per_run: Optional[int] = Field(default=None, ge=1, le=10)
    auto_run: Optional[bool] = None
    run_interval_minutes: Optional[int] = Field(default=None, ge=1, le=1440)
    house_rules: Optional[str] = None
    team_directory: Optional[str] = None


# ---------------------------------------------------------------- serialisers

def _dt(v):
    return v.isoformat() if v else None


def task_out(t: AgentTask, full: bool = False) -> Dict[str, Any]:
    open_q = [q for q in t.questions if q.status == "open"]
    ready = [a for a in t.actions if a.status == "proposed"]
    out = {
        "id": t.id, "title": t.title, "notes": t.notes, "priority": t.priority, "due_date": t.due_date,
        "status": t.status, "summary": t.summary, "review_flag": t.review_flag, "run_count": t.run_count,
        "last_run_at": _dt(t.last_run_at), "created_at": _dt(t.created_at), "updated_at": _dt(t.updated_at),
        "open_questions": len(open_q), "ready_actions": len(ready),
    }
    if full:
        out["questions"] = [question_out(q) for q in t.questions]
        out["actions"] = [action_out(a) for a in t.actions if a.status != "superseded"]
        out["events"] = [event_out(e) for e in t.events]
    return out


def question_out(q: AgentQuestion) -> Dict[str, Any]:
    return {"id": q.id, "task_id": q.task_id, "asked_by": q.asked_by, "question": q.question, "why": q.why,
            "answer": q.answer, "status": q.status, "created_at": _dt(q.created_at)}


def action_out(a: AgentAction) -> Dict[str, Any]:
    return {"id": a.id, "task_id": a.task_id, "kind": a.kind, "title": a.title, "content": a.content,
            "details": a.details or {}, "status": a.status, "review_status": a.review_status,
            "review_score": a.review_score, "review_notes": a.review_notes, "user_feedback": a.user_feedback,
            "created_at": _dt(a.created_at)}


def event_out(e: AgentEvent) -> Dict[str, Any]:
    return {"id": e.id, "kind": e.kind, "actor": e.actor, "attempt": e.attempt, "content": e.content,
            "created_at": _dt(e.created_at)}


def agent_out(a: AgentConfig) -> Dict[str, Any]:
    return {"id": a.id, "name": a.name, "role": a.role, "description": a.description,
            "instructions": a.instructions, "provider": a.provider, "model": a.model,
            "resolved_provider": llm.resolve_provider(a.provider),
            "resolved_model": a.model or llm.DEFAULT_MODELS.get(llm.resolve_provider(a.provider)),
            "temperature": a.temperature, "position": a.position, "enabled": a.enabled,
            "can_ask_questions": a.can_ask_questions}


def pipeline_out(p) -> Dict[str, Any]:
    return {"max_revisions": p.max_revisions, "approval_threshold": p.approval_threshold,
            "max_questions_per_run": p.max_questions_per_run, "auto_run": p.auto_run,
            "run_interval_minutes": p.run_interval_minutes, "house_rules": p.house_rules,
            "team_directory": p.team_directory or ""}


# ---------------------------------------------------------------- helpers

def _get(db: Session, model, obj_id: str):
    obj = db.get(model, obj_id)
    if obj is None:
        raise HTTPException(404, f"{model.__name__} not found")
    return obj


def _queue(db: Session, task: AgentTask, background: Optional[BackgroundTasks], reason: str):
    """Put a task back in the queue and, if asked, start the team on it straight away."""
    if task.status == "processing":
        raise HTTPException(409, "Agents are already working on this task.")
    task.status = "queued"
    orchestrator.log_event(db, task, "status", "tom", {"status": "queued", "reason": reason})
    db.commit()
    if background is not None:
        background.add_task(orchestrator.process_queue, 5)


# ---------------------------------------------------------------- briefing

@router.get("/briefing")
def briefing(db: Session = Depends(get_db)):
    """Everything waiting for Tom: questions to answer and reviewed actions to approve."""
    orchestrator.seed_defaults(db)
    open_q = (db.query(AgentQuestion).join(AgentTask)
              .filter(AgentQuestion.status == "open", AgentTask.status == "needs_input")
              .order_by(AgentTask.priority, AgentQuestion.created_at).all())
    ready = (db.query(AgentAction).join(AgentTask)
             .filter(AgentAction.status == "proposed", AgentTask.status == "ready")
             .order_by(AgentTask.priority, AgentTask.created_at, AgentAction.position).all())
    counts = {s: db.query(AgentTask).filter(AgentTask.status == s).count() for s in
              ["queued", "processing", "needs_input", "ready", "failed", "done"]}
    tasks = {t.id: t for t in db.query(AgentTask).filter(AgentTask.status.in_(["needs_input", "ready", "failed"]))}
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "counts": counts,
        "questions": [{**question_out(q), "task_title": q.task.title} for q in open_q],
        "actions": [{**action_out(a), "task_title": a.task.title, "task_review_flag": a.task.review_flag}
                    for a in ready],
        "failed": [task_out(t) for t in tasks.values() if t.status == "failed"],
        "providers": llm.available_providers(),
    }


# ---------------------------------------------------------------- tasks

@router.get("/tasks")
def list_tasks(status: Optional[str] = None, include_done: bool = False, db: Session = Depends(get_db)):
    q = db.query(AgentTask)
    if status:
        q = q.filter(AgentTask.status == status)
    elif not include_done:
        q = q.filter(AgentTask.status != "done")
    return [task_out(t) for t in q.order_by(AgentTask.priority, AgentTask.created_at.desc()).all()]


@router.post("/tasks", status_code=201)
def create_task(body: TaskIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    orchestrator.seed_defaults(db)
    task = AgentTask(title=body.title.strip(), notes=body.notes, priority=body.priority,
                     due_date=body.due_date, status="queued")
    db.add(task)
    db.commit()
    if body.run_now:
        background.add_task(orchestrator.process_queue, 5)
    return task_out(task, full=True)


@router.post("/capture", status_code=201)
def capture(body: CaptureIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Brain dump: split free text into separate tasks and queue them all."""
    orchestrator.seed_defaults(db)
    try:
        items = orchestrator.split_capture(db, body.text)
    except llm.LLMError as e:
        raise HTTPException(502, f"Could not split that into tasks: {e}")
    if not items:
        raise HTTPException(422, "No tasks found in that text.")
    tasks = [AgentTask(status="queued", **item) for item in items]
    db.add_all(tasks)
    db.commit()
    if body.run_now:
        background.add_task(orchestrator.process_queue, 20)
    return [task_out(t) for t in tasks]


@router.get("/tasks/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)):
    return task_out(_get(db, AgentTask, task_id), full=True)


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, body: TaskPatch, db: Session = Depends(get_db)):
    task = _get(db, AgentTask, task_id)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in ("done", "queued"):
        raise HTTPException(400, "Status can only be set to 'done' or 'queued' directly.")
    for k, v in data.items():
        setattr(task, k, v)
    db.commit()
    return task_out(task, full=True)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    db.delete(_get(db, AgentTask, task_id))
    db.commit()


@router.post("/tasks/{task_id}/run")
def run_task_now(task_id: str, background: BackgroundTasks, db: Session = Depends(get_db)):
    task = _get(db, AgentTask, task_id)
    _queue(db, task, background, "manual re-run")
    return task_out(task)


@router.post("/tasks/{task_id}/feedback")
def task_feedback(task_id: str, body: TextIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Tell the team what to change; they rework the task with it."""
    task = _get(db, AgentTask, task_id)
    orchestrator.log_event(db, task, "feedback", "tom", {"text": body.text})
    _queue(db, task, background, "feedback")
    return task_out(task, full=True)


# ---------------------------------------------------------------- questions

@router.post("/questions/{question_id}/answer")
def answer_question(question_id: str, body: AnswerIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    q = _get(db, AgentQuestion, question_id)
    q.answer, q.status, q.answered_at = body.answer, "answered", dt.datetime.now(dt.timezone.utc)
    task = q.task
    orchestrator.log_event(db, task, "answer", "tom", {"question": q.question, "answer": body.answer})
    db.commit()
    resumed = False
    if task.status == "needs_input" and not any(x.status == "open" for x in task.questions):
        _queue(db, task, background, "questions answered")
        resumed = True
    return {"question": question_out(q), "task_resumed": resumed}


@router.post("/questions/{question_id}/dismiss")
def dismiss_question(question_id: str, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Tom will not answer: the agents must proceed on sensible assumptions."""
    q = _get(db, AgentQuestion, question_id)
    q.status = "dismissed"
    task = q.task
    db.commit()
    resumed = False
    if task.status == "needs_input" and not any(x.status == "open" for x in task.questions):
        _queue(db, task, background, "questions dismissed")
        resumed = True
    return {"question": question_out(q), "task_resumed": resumed}


# ---------------------------------------------------------------- actions

@router.patch("/actions/{action_id}")
def edit_action(action_id: str, body: ActionPatch, db: Session = Depends(get_db)):
    a = _get(db, AgentAction, action_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    db.commit()
    return action_out(a)


def _close_task_if_settled(task: AgentTask):
    if task.status == "ready" and not any(a.status == "proposed" for a in task.actions):
        task.status = "done"


@router.post("/actions/{action_id}/approve")
async def approve_action(action_id: str, body: ApproveIn, db: Session = Depends(get_db)):
    a = _get(db, AgentAction, action_id)
    result: Dict[str, Any] = {}
    if body.create_outlook_draft:
        if a.kind != "email_draft" or not (a.details or {}).get("to"):
            raise HTTPException(400, "Only email drafts with a recipient can be sent to Outlook.")
        # Creates a draft in Outlook. Nothing is ever sent automatically.
        from ..outlook import create_draft
        body_html = (a.content or "").replace("\n", "<br>")
        result = await create_draft(to=a.details["to"], subject=a.details.get("subject") or a.title,
                                    body_html=body_html, db=db)
        a.details = {**(a.details or {}), "outlook_draft_id": result.get("draft_id")}
    a.status = "approved"
    orchestrator.log_event(db, a.task, "status", "tom", {"action": a.title, "status": "approved", **result})
    _close_task_if_settled(a.task)
    db.commit()
    return {"action": action_out(a), "task_status": a.task.status, **result}


@router.post("/actions/{action_id}/reject")
def reject_action(action_id: str, body: RejectIn, background: BackgroundTasks, db: Session = Depends(get_db)):
    a = _get(db, AgentAction, action_id)
    a.status, a.user_feedback = "rejected", body.reason or None
    task = a.task
    orchestrator.log_event(db, task, "feedback", "tom",
                           {"text": f"Rejected '{a.title}'. {body.reason}".strip(), "action_id": a.id})
    db.commit()
    if body.rework:
        _queue(db, task, background, "action rejected")
    else:
        _close_task_if_settled(task)
        db.commit()
    return {"action": action_out(a), "task_status": task.status}


@router.post("/actions/{action_id}/done")
def complete_action(action_id: str, db: Session = Depends(get_db)):
    a = _get(db, AgentAction, action_id)
    a.status = "done"
    _close_task_if_settled(a.task)
    db.commit()
    return {"action": action_out(a), "task_status": a.task.status}


# ---------------------------------------------------------------- agent team

@router.get("/agents")
def list_agents(db: Session = Depends(get_db)):
    orchestrator.seed_defaults(db)
    agents = db.query(AgentConfig).order_by(AgentConfig.role.desc(), AgentConfig.position,
                                            AgentConfig.created_at).all()
    return {"agents": [agent_out(a) for a in agents], "pipeline": pipeline_out(orchestrator.get_pipeline(db)),
            "providers": llm.available_providers(), "default_models": llm.DEFAULT_MODELS}


@router.post("/agents", status_code=201)
def create_agent(body: AgentIn, db: Session = Depends(get_db)):
    orchestrator.seed_defaults(db)  # a first custom agent must not suppress the default team
    data = body.model_dump()
    if data["position"] is None:
        data["position"] = db.query(AgentConfig).filter(AgentConfig.role == body.role).count()
    agent = AgentConfig(**data)
    db.add(agent)
    db.commit()
    return agent_out(agent)


@router.patch("/agents/{agent_id}")
def update_agent(agent_id: str, body: AgentPatch, db: Session = Depends(get_db)):
    agent = _get(db, AgentConfig, agent_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(agent, k, v)
    db.commit()
    return agent_out(agent)


@router.delete("/agents/{agent_id}", status_code=204)
def delete_agent(agent_id: str, db: Session = Depends(get_db)):
    db.delete(_get(db, AgentConfig, agent_id))
    db.commit()


@router.post("/agents/reorder")
def reorder_agents(body: ReorderIn, db: Session = Depends(get_db)):
    for i, agent_id in enumerate(body.ids):
        _get(db, AgentConfig, agent_id).position = i
    db.commit()
    return list_agents(db)


@router.post("/agents/reset")
def reset_agents(db: Session = Depends(get_db)):
    orchestrator.seed_defaults(db, force=True)
    return list_agents(db)


@router.patch("/pipeline")
def update_pipeline(body: PipelinePatch, db: Session = Depends(get_db)):
    p = orchestrator.get_pipeline(db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    return pipeline_out(p)


@router.post("/run")
def run_queue(background: BackgroundTasks):
    """Process every queued task now instead of waiting for the next background cycle."""
    background.add_task(orchestrator.process_queue, 50)
    return {"started": True}
