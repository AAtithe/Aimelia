"""
Database models for the agentic task list.

Kept portable (String ids, generic JSON) so the module runs on PostgreSQL in
production and SQLite in tests.
"""
import datetime
import uuid
from sqlalchemy import Column, String, Text, Integer, Float, Boolean, JSON, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..db import Base


def _id() -> str:
    return str(uuid.uuid4())


# Task lifecycle
#   queued      -> waiting for the agent team to pick it up
#   processing  -> agents are working on it now
#   needs_input -> agents have asked questions that need an answer
#   ready       -> reviewed actions are waiting for approval
#   done        -> closed by the user
#   failed      -> the run errored; see events
#   scheduled   -> parked until scheduled_for (deferred work, follow-ups, routines)
#   due         -> a follow-up on delegated work has reached its date
TASK_STATUSES = ["queued", "processing", "needs_input", "ready", "done", "failed", "scheduled", "due"]


class AgentTask(Base):
    __tablename__ = "agent_tasks"

    id = Column(String(36), primary_key=True, default=_id)
    title = Column(String(500), nullable=False)
    notes = Column(Text, default="")
    priority = Column(Integer, default=2)  # 1 high, 2 normal, 3 low
    due_date = Column(String(10), nullable=True)  # YYYY-MM-DD
    status = Column(String(20), default="queued", index=True)
    summary = Column(Text, default="")  # latest agent summary of the task
    review_flag = Column(Text, nullable=True)  # set when the reviewer never approved
    run_count = Column(Integer, default=0)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    kind = Column(String(20), default="task")  # task | follow_up | routine
    parent_id = Column(String(36), nullable=True)  # the task a follow-up checks on
    routine_id = Column(String(36), nullable=True)
    scheduled_for = Column(String(10), nullable=True)  # YYYY-MM-DD it wakes up
    follow_up = Column(JSON, nullable=True)  # {"owner", "handover", "action_id"} for follow-ups
    last_touched_at = Column(DateTime(timezone=True), nullable=True)  # last time Tom did anything with it
    stale_nudged_at = Column(DateTime(timezone=True), nullable=True)
    calendar_event = Column(JSON, nullable=True)  # {"id", "start", "end"} when time is booked
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    questions = relationship("AgentQuestion", back_populates="task", cascade="all, delete-orphan",
                             order_by="AgentQuestion.created_at")
    actions = relationship("AgentAction", back_populates="task", cascade="all, delete-orphan",
                           order_by="AgentAction.position")
    events = relationship("AgentEvent", back_populates="task", cascade="all, delete-orphan",
                          order_by="AgentEvent.created_at")


class AgentQuestion(Base):
    __tablename__ = "agent_questions"

    id = Column(String(36), primary_key=True, default=_id)
    task_id = Column(String(36), ForeignKey("agent_tasks.id", ondelete="CASCADE"), index=True)
    asked_by = Column(String(100))
    question = Column(Text, nullable=False)
    why = Column(Text, default="")  # why the agent needs this
    answer = Column(Text, nullable=True)
    status = Column(String(20), default="open")  # open | answered | dismissed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    answered_at = Column(DateTime(timezone=True), nullable=True)

    task = relationship("AgentTask", back_populates="questions")


class AgentAction(Base):
    __tablename__ = "agent_actions"

    id = Column(String(36), primary_key=True, default=_id)
    task_id = Column(String(36), ForeignKey("agent_tasks.id", ondelete="CASCADE"), index=True)
    position = Column(Integer, default=0)
    kind = Column(String(40), default="note")  # email_draft | document | checklist | decision | call | note
    title = Column(String(500), nullable=False)
    content = Column(Text, default="")
    details = Column(JSON, default=dict)  # e.g. {"to": "...", "subject": "..."} for email drafts
    status = Column(String(20), default="proposed")  # proposed | approved | rejected | done | superseded
    review_status = Column(String(20), default="approved")  # approved | flagged
    review_score = Column(Float, nullable=True)
    review_notes = Column(Text, default="")
    user_feedback = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    task = relationship("AgentTask", back_populates="actions")


class AgentEvent(Base):
    """Timeline of everything that happened on a task (agent outputs, reviews, user input)."""
    __tablename__ = "agent_events"

    id = Column(String(36), primary_key=True, default=_id)
    task_id = Column(String(36), ForeignKey("agent_tasks.id", ondelete="CASCADE"), index=True)
    kind = Column(String(30))  # worker | review | question | answer | feedback | status | error
    actor = Column(String(100))
    attempt = Column(Integer, default=0)
    content = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    task = relationship("AgentTask", back_populates="events")


class AgentConfig(Base):
    """One member of the agent team. Fully editable from the UI."""
    __tablename__ = "agent_configs"

    id = Column(String(36), primary_key=True, default=_id)
    name = Column(String(100), nullable=False)
    role = Column(String(20), default="worker")  # worker | reviewer
    description = Column(Text, default="")
    instructions = Column(Text, nullable=False)  # the agent's system prompt
    provider = Column(String(20), default="auto")  # auto | anthropic | openai | mock
    model = Column(String(100), nullable=True)  # blank = provider default
    temperature = Column(Float, default=0.3)
    position = Column(Integer, default=0)  # run order within its role
    enabled = Column(Boolean, default=True)
    can_ask_questions = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AgentPipelineSettings(Base):
    """Single-row table holding how the team collaborates."""
    __tablename__ = "agent_pipeline_settings"

    id = Column(Integer, primary_key=True, default=1)
    max_revisions = Column(Integer, default=2)  # reviewer send-backs before flagging
    approval_threshold = Column(Float, default=7.0)  # reviewer score (0-10) needed to approve
    max_questions_per_run = Column(Integer, default=3)
    auto_run = Column(Boolean, default=True)  # background loop picks up queued tasks
    run_interval_minutes = Column(Integer, default=10)
    house_rules = Column(Text, default="")  # standing instructions shared with every agent
    team_directory = Column(Text, default="")  # who at WS owns what, so work can be delegated
    defaults_version = Column(Integer, default=0)  # which default agents have been offered
    stale_days = Column(Integer, default=14)  # untouched this long -> back through Triage
    lessons_in_context = Column(Integer, default=8)  # how many of Tom's corrections every agent sees
    brief_enabled = Column(Boolean, default=False)  # morning push to Teams / phone
    brief_time = Column(String(5), default="07:30")  # London time
    brief_weekends = Column(Boolean, default=False)
    last_brief_date = Column(String(10), nullable=True)
    work_start = Column(String(5), default="09:00")  # for booking focus time
    work_end = Column(String(5), default="17:30")
    focus_minutes = Column(Integer, default=60)
    use_ws_systems = Column(Boolean, default=True)  # let agents read WSCIP and Payroll Command Center
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AgentRoutine(Base):
    """Recurring work the team prepares before it is due (board pack, month-end, one-to-ones)."""
    __tablename__ = "agent_routines"

    id = Column(String(36), primary_key=True, default=_id)
    title = Column(String(500), nullable=False)
    notes = Column(Text, default="")
    priority = Column(Integer, default=2)
    cadence = Column(String(20), default="weekly")  # weekly | fortnightly | monthly | quarterly
    weekday = Column(Integer, default=0)  # 0 Monday, for weekly and fortnightly
    day_of_month = Column(Integer, default=1)  # 1-28, or -1 for the last day, for monthly and quarterly
    lead_days = Column(Integer, default=3)  # create the task this many days before it is due
    next_due = Column(String(10), nullable=False)  # YYYY-MM-DD of the next occurrence
    enabled = Column(Boolean, default=True)
    created_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AgentLesson(Base):
    """A correction Tom made, shown to the agents so the same mistake is not repeated."""
    __tablename__ = "agent_lessons"

    id = Column(String(36), primary_key=True, default=_id)
    source = Column(String(20))  # edit | rejection | feedback
    action_kind = Column(String(40), nullable=True)
    task_title = Column(String(500), default="")
    before = Column(Text, default="")
    after = Column(Text, default="")
    note = Column(Text, default="")
    active = Column(Boolean, default=True)
    # Set in Python for sub-second precision, so "newest first" holds when two lessons land together.
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.datetime.now(datetime.timezone.utc))


def ensure_schema(engine) -> None:
    """Add columns introduced after a table was first created (create_all never alters tables)."""
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    for model in (AgentTask, AgentQuestion, AgentAction, AgentEvent, AgentConfig, AgentPipelineSettings,
                  AgentRoutine, AgentLesson):
        table = model.__table__
        if not insp.has_table(table.name):
            continue
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing:
                continue
            ddl = col.type.compile(dialect=engine.dialect)
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl}'))
