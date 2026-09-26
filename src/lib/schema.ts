/**
 * The whole database, as idempotent statements. Safe to run on every cold start:
 * CREATE ... IF NOT EXISTS for tables, ADD COLUMN IF NOT EXISTS for anything added later.
 * Append new statements at the end; never edit one that has shipped.
 */
export const SCHEMA: string[] = [
  // ---------------------------------------------------------------- agent tasks
  `CREATE TABLE IF NOT EXISTS tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    notes text NOT NULL DEFAULT '',
    priority int NOT NULL DEFAULT 2,
    due_date text,
    status text NOT NULL DEFAULT 'queued',
    summary text NOT NULL DEFAULT '',
    review_flag text,
    run_count int NOT NULL DEFAULT 0,
    last_run_at timestamptz,
    kind text NOT NULL DEFAULT 'task',
    parent_id uuid,
    routine_id uuid,
    scheduled_for text,
    follow_up jsonb,
    last_touched_at timestamptz,
    stale_nudged_at timestamptz,
    calendar_event jsonb,
    claimed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status)`,
  `CREATE TABLE IF NOT EXISTS questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    asked_by text NOT NULL DEFAULT '',
    question text NOT NULL,
    why text NOT NULL DEFAULT '',
    answer text,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    answered_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS questions_task_idx ON questions (task_id)`,
  `CREATE TABLE IF NOT EXISTS actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    position int NOT NULL DEFAULT 0,
    kind text NOT NULL DEFAULT 'note',
    title text NOT NULL,
    content text NOT NULL DEFAULT '',
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'proposed',
    review_status text NOT NULL DEFAULT 'approved',
    review_score real,
    review_notes text NOT NULL DEFAULT '',
    user_feedback text,
    edited boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS actions_task_idx ON actions (task_id)`,
  `CREATE TABLE IF NOT EXISTS events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind text NOT NULL,
    actor text NOT NULL DEFAULT '',
    attempt int NOT NULL DEFAULT 0,
    content jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  `CREATE INDEX IF NOT EXISTS events_task_idx ON events (task_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    role text NOT NULL DEFAULT 'worker',
    description text NOT NULL DEFAULT '',
    instructions text NOT NULL,
    provider text NOT NULL DEFAULT 'auto',
    model text,
    temperature real NOT NULL DEFAULT 0.3,
    position int NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT true,
    can_ask_questions boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS pipeline (
    id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_revisions int NOT NULL DEFAULT 2,
    approval_threshold real NOT NULL DEFAULT 7,
    max_questions_per_run int NOT NULL DEFAULT 3,
    auto_run boolean NOT NULL DEFAULT true,
    house_rules text NOT NULL DEFAULT '',
    team_directory text NOT NULL DEFAULT '',
    defaults_version int NOT NULL DEFAULT 0,
    stale_days int NOT NULL DEFAULT 14,
    lessons_in_context int NOT NULL DEFAULT 8,
    brief_enabled boolean NOT NULL DEFAULT false,
    brief_time text NOT NULL DEFAULT '07:30',
    brief_weekends boolean NOT NULL DEFAULT false,
    last_brief_date text,
    work_start text NOT NULL DEFAULT '09:00',
    work_end text NOT NULL DEFAULT '17:30',
    focus_minutes int NOT NULL DEFAULT 60,
    use_ws_systems boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS routines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    notes text NOT NULL DEFAULT '',
    priority int NOT NULL DEFAULT 2,
    cadence text NOT NULL DEFAULT 'weekly',
    weekday int NOT NULL DEFAULT 0,
    day_of_month int NOT NULL DEFAULT 1,
    lead_days int NOT NULL DEFAULT 3,
    next_due text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_count int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS lessons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    action_kind text,
    task_title text NOT NULL DEFAULT '',
    before text NOT NULL DEFAULT '',
    after text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  // ---------------------------------------------------------------- Microsoft 365 connection
  `CREATE TABLE IF NOT EXISTS ms_tokens (
    owner text PRIMARY KEY,
    account text NOT NULL DEFAULT '',
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  // ---------------------------------------------------------------- rate limiting for sign-in
  `CREATE TABLE IF NOT EXISTS sign_in_attempts (
    id bigserial PRIMARY KEY,
    ip text NOT NULL DEFAULT '',
    ok boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
]
