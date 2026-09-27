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
  // One question can stand for several: the others are merged into it and settle with it.
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES questions(id) ON DELETE SET NULL`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS updated_at timestamptz`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS answered_by text`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS suggested_answer text`,
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS suggested_from text`,
  `CREATE INDEX IF NOT EXISTS questions_merged_idx ON questions (merged_into) WHERE merged_into IS NOT NULL`,
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
  // ---------------------------------------------------------------- email and calendar
  `CREATE TABLE IF NOT EXISTS emails (
    graph_id text PRIMARY KEY,
    conversation_id text,
    from_email text NOT NULL DEFAULT '',
    from_name text NOT NULL DEFAULT '',
    subject text NOT NULL DEFAULT '',
    preview text NOT NULL DEFAULT '',
    received_at timestamptz,
    is_read boolean NOT NULL DEFAULT false,
    category text NOT NULL DEFAULT 'General',
    urgency int NOT NULL DEFAULT 3,
    confidence real NOT NULL DEFAULT 0,
    method text NOT NULL DEFAULT 'rules',
    reasoning text NOT NULL DEFAULT '',
    action_required text,
    summary text,
    suggested_reply text,
    draft_id text,
    draft_link text,
    triaged_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS emails_received_idx ON emails (received_at DESC)`,
  `CREATE TABLE IF NOT EXISTS meetings (
    graph_event_id text PRIMARY KEY,
    subject text NOT NULL DEFAULT '',
    start_at timestamptz,
    end_at timestamptz,
    attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
    organizer text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '',
    is_online boolean NOT NULL DEFAULT false,
    join_url text,
    brief text,
    brief_style text,
    brief_word_count int,
    recent_comms_count int NOT NULL DEFAULT 0,
    brief_generated_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS kb_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL DEFAULT 'document',
    source_id text,
    title text NOT NULL,
    chunk text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || chunk)) STORED
  )`,
  `CREATE INDEX IF NOT EXISTS kb_chunks_tsv_idx ON kb_chunks USING gin (tsv)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS kb_chunks_source_idx ON kb_chunks (source, source_id, title)`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id text PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT true,
    options jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_run_at timestamptz,
    last_slot text,
    last_result jsonb
  )`,
  `CREATE TABLE IF NOT EXISTS job_logs (
    id bigserial PRIMARY KEY,
    job text NOT NULL,
    level text NOT NULL DEFAULT 'info',
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  // ---------------------------------------------------------------- people, sessions, settings
  `CREATE TABLE IF NOT EXISTS app_config (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    name text NOT NULL DEFAULT '',
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'owner',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_sign_in_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent text NOT NULL DEFAULT '',
    ip text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT 'Capture key',
    token_hash text NOT NULL UNIQUE,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `ALTER TABLE sign_in_attempts ADD COLUMN IF NOT EXISTS email text NOT NULL DEFAULT ''`,
  // ---------------------------------------------------------------- task imports
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source text`,
  // Days after an approved email or call that Aimelia checks it came back; 0 switches it off. Handovers always follow up on their due date.
  `ALTER TABLE pipeline ADD COLUMN IF NOT EXISTS follow_up_days int NOT NULL DEFAULT 7`,
  `CREATE TABLE IF NOT EXISTS imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    ref text NOT NULL,
    title text NOT NULL DEFAULT '',
    task_count int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS imports_source_ref_idx ON imports (source, ref)`,
  // ---------------------------------------------------------------- Ask Aimelia: the chat agent
  `CREATE TABLE IF NOT EXISTS chats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role text NOT NULL,
    content text NOT NULL,
    steps jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  `CREATE INDEX IF NOT EXISTS chat_messages_chat_idx ON chat_messages (chat_id, created_at)`,
  // Imports the AI reads run as jobs, so a long PDF never depends on one browser request staying open.
  `CREATE TABLE IF NOT EXISTS import_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'queued',
    kind text NOT NULL,
    title text NOT NULL DEFAULT '',
    ref text NOT NULL,
    text text NOT NULL DEFAULT '',
    pdf text,
    force boolean NOT NULL DEFAULT false,
    run_now boolean NOT NULL DEFAULT true,
    attempts int NOT NULL DEFAULT 0,
    error text,
    warning text,
    task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    prior jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS chat_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    name text NOT NULL,
    kind text NOT NULL,
    media_type text NOT NULL,
    size int NOT NULL DEFAULT 0,
    data text,
    text text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  `CREATE INDEX IF NOT EXISTS chat_files_message_idx ON chat_files (message_id)`,
  // What Tom tells Ask Aimelia to remember, carried into every conversation.
  `CREATE TABLE IF NOT EXISTS chat_memory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fact text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  // ---------------------------------------------------------------- memory: what Aimelia knows
  // Everything Tom tells Aimelia, word for word. Never removed when a task is; only Tom can delete a note.
  `CREATE TABLE IF NOT EXISTS memory_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    ref text NOT NULL,
    text text NOT NULL,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    claimed_at timestamptz,
    attempts int NOT NULL DEFAULT 0,
    error text
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS memory_notes_ref_idx ON memory_notes (source, ref)`,
  `CREATE INDEX IF NOT EXISTS memory_notes_open_idx ON memory_notes (processed_at, created_at)`,
  // The facts drawn from them. pinned means Tom wrote or edited it: agents may question it but never change it.
  `CREATE TABLE IF NOT EXISTS memories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL DEFAULT 'fact',
    subject text NOT NULL DEFAULT '',
    content text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    pinned boolean NOT NULL DEFAULT false,
    sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by text NOT NULL DEFAULT 'aimelia',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', subject || ' ' || content)) STORED
  )`,
  `CREATE INDEX IF NOT EXISTS memories_tsv_idx ON memories USING gin (tsv)`,
  `CREATE INDEX IF NOT EXISTS memories_status_idx ON memories (status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS memory_questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question text NOT NULL,
    why text NOT NULL DEFAULT '',
    memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    asked_by text NOT NULL DEFAULT 'weekly_check',
    status text NOT NULL DEFAULT 'open',
    answer text,
    created_at timestamptz NOT NULL DEFAULT now(),
    answered_at timestamptz
  )`,
  // Every change to a memory, by whom, before and after. Kept when the memory is deleted.
  `CREATE TABLE IF NOT EXISTS memory_log (
    id bigserial PRIMARY KEY,
    memory_id uuid,
    action text NOT NULL,
    actor text NOT NULL,
    before jsonb,
    after jsonb,
    note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  )`,
  `CREATE INDEX IF NOT EXISTS memory_log_memory_idx ON memory_log (memory_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS memory_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    week text NOT NULL,
    trigger text NOT NULL DEFAULT 'weekly',
    status text NOT NULL DEFAULT 'running',
    summary text NOT NULL DEFAULT '',
    counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    error text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
  )`,
  // One weekly check per week, however many ticks see it due at once.
  `CREATE UNIQUE INDEX IF NOT EXISTS memory_reviews_week_idx ON memory_reviews (week) WHERE trigger = 'weekly'`,
]
