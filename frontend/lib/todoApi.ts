// Client for the agentic task list API (/todo on the Aimelia backend).
// The access key is entered once in the browser and kept in localStorage.

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://aimelia-api.onrender.com'
const KEY_STORAGE = 'aimelia_access_key'

export type TaskStatus = 'queued' | 'processing' | 'needs_input' | 'ready' | 'done' | 'failed'

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
}

export interface Briefing {
  generated_at: string
  counts: Record<string, number>
  questions: Question[]
  actions: Action[]
  failed: Task[]
  providers: Record<string, boolean>
}

export function getKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

export function setKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    // storage unavailable: the key lasts for this page only
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function api<T = any>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/todo${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Aimelia-Key': getKey() },
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
    throw new ApiError(res.status, detail)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  processing: 'Agents working',
  needs_input: 'Needs your answer',
  ready: 'Ready to approve',
  done: 'Done',
  failed: 'Failed',
}

// House pill classes (see app/tasks/house.css). Colour is meaning, not decoration.
export const STATUS_PILL: Record<TaskStatus, string> = {
  queued: 'Unscheduled',
  processing: 'Active',
  needs_input: 'Atrisk',
  ready: 'Ontrack',
  done: 'Done',
  failed: 'Overdue',
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
