// Client for the agentic task list API (/todo on the Aimelia backend).
// The access key is entered once in the browser and kept in localStorage.

// Browser client for the Aimelia API. Same origin, authenticated by the HttpOnly session cookie.

export type TaskStatus = 'queued' | 'processing' | 'needs_input' | 'ready' | 'done' | 'failed' | 'scheduled' | 'due'

export interface Question {
  id: string
  task_id: string
  task_title?: string
  asked_by: string
  question: string
  why: string
  answer: string | null
  status: 'open' | 'answered' | 'dismissed'
  created_at: string
}

export interface Action {
  id: string
  task_id: string
  task_title?: string
  task_review_flag?: string | null
  kind: string
  title: string
  content: string
  details: Record<string, any>
  status: 'proposed' | 'approved' | 'rejected' | 'done' | 'superseded'
  review_status: 'approved' | 'flagged'
  review_score: number | null
  review_notes: string
  user_feedback: string | null
}

export interface AgentEvent {
  id: string
  kind: string
  actor: string
  attempt: number
  content: Record<string, any>
  created_at: string
}

export interface Task {
  id: string
  title: string
  notes: string
  priority: number
  due_date: string | null
  status: TaskStatus
  summary: string
  review_flag: string | null
  run_count: number
  last_run_at: string | null
  created_at: string
  open_questions: number
  ready_actions: number
  kind: 'task' | 'follow_up' | 'routine'
  parent_id: string | null
  routine_id: string | null
  scheduled_for: string | null
  follow_up_owner: string | null
  calendar_event: { id: string; start: string; end: string; link?: string } | null
  stale_nudged_at: string | null
  source?: string | null
  handover?: string
  questions?: Question[]
  actions?: Action[]
  events?: AgentEvent[]
}

export interface Agent {
  id: string
  name: string
  role: 'worker' | 'reviewer'
  description: string
  instructions: string
  provider: 'auto' | 'anthropic' | 'openai' | 'mock'
  model: string | null
  resolved_provider: string
  resolved_model: string
  temperature: number
  position: number
  enabled: boolean
  can_ask_questions: boolean
}

export interface Pipeline {
  max_revisions: number
  approval_threshold: number
  max_questions_per_run: number
  auto_run: boolean
  run_interval_minutes: number
  house_rules: string
  team_directory: string
  stale_days: number
  lessons_in_context: number
  brief_enabled: boolean
  brief_time: string
  brief_weekends: boolean
  last_brief_date: string | null
  work_start: string
  work_end: string
  focus_minutes: number
  use_ws_systems: boolean
}

export interface Routine {
  id: string
  title: string
  notes: string
  priority: number
  cadence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly'
  weekday: number
  day_of_month: number
  lead_days: number
  next_due: string
  enabled: boolean
  created_count: number
}

export interface Lesson {
  id: string
  source: 'edit' | 'rejection' | 'feedback'
  action_kind: string | null
  task_title: string
  before: string
  after: string
  note: string
  active: boolean
  created_at: string
}

export interface MonthStats {
  month: string
  delivered: number
  approved_as_is: number
  edited: number
  sent_back: number
}

export interface Briefing {
  generated_at: string
  counts: Record<string, number>
  questions: Question[]
  actions: Action[]
  failed: Task[]
  follow_ups: Task[]
  providers: Record<string, boolean>
  channels: Record<string, boolean>
  sources: Record<string, boolean>
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Fired when the session has ended, so the shell can show the sign-in screen. */
export const SIGNED_OUT = 'aimelia:signed-out'

async function request<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
    } catch {
      // keep statusText
    }
    // Only an Aimelia session ending signs you out; a Microsoft 365 "not connected" is a normal error.
    if (res.status === 401 && !/Microsoft 365/.test(detail)) window.dispatchEvent(new Event(SIGNED_OUT))
    throw new ApiError(res.status, detail)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

/** Agent Tasks API. */
export const api = <T = any>(path: string, options: { method?: string; body?: unknown } = {}) => request<T>(`/api/todo${path}`, options)
/** Email, calendar and briefing API. */
export const mail = <T = any>(path: string, options: { method?: string; body?: unknown } = {}) => request<T>(`/api/mail${path}`, options)
/** Anything else under /api. */
export const raw = <T = any>(path: string, options: { method?: string; body?: unknown } = {}) => request<T>(`/api${path}`, options)

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  processing: 'Agents working',
  needs_input: 'Needs your answer',
  ready: 'Ready to approve',
  done: 'Done',
  failed: 'Failed',
  scheduled: 'Scheduled',
  due: 'Follow-up due',
}

// House pill classes (from the shared src/app/ws-house.css). Colour is meaning, not decoration.
export const STATUS_PILL: Record<TaskStatus, string> = {
  queued: 'Unscheduled',
  processing: 'Active',
  needs_input: 'Atrisk',
  ready: 'Ontrack',
  done: 'Done',
  failed: 'Overdue',
  scheduled: 'Parked',
  due: 'Atrisk',
}

export const KIND_LABEL: Record<string, string> = {
  email_draft: 'Email draft',
  document: 'Document',
  checklist: 'Checklist',
  decision: 'Decision',
  call: 'Call or meeting',
  delegate: 'Hand over',
  note: 'Note',
}

export const PRIORITY_LABEL = ['', 'High', 'Normal', 'Low']

/** "26 Sept 2026", the house date format. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  return `${fmtDate(value)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/** Due state is derived from the date, never typed: overdue, due today, or on track. */
export function dueState(due: string | null, status: TaskStatus): { pill: string; label: string } | null {
  if (!due || status === 'done') return null
  const today = new Date().toISOString().slice(0, 10)
  if (due < today) return { pill: 'Overdue', label: 'Overdue' }
  if (due === today) return { pill: 'Atrisk', label: 'Due today' }
  return null
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function cadenceText(r: Pick<Routine, 'cadence' | 'weekday' | 'day_of_month'>): string {
  const day = r.day_of_month === -1 ? 'the last day' : `day ${r.day_of_month}`
  if (r.cadence === 'weekly') return `Every ${WEEKDAYS[r.weekday]}`
  if (r.cadence === 'fortnightly') return `Every other ${WEEKDAYS[r.weekday]}`
  if (r.cadence === 'monthly') return `Monthly on ${day}`
  return `Quarterly on ${day}`
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}
