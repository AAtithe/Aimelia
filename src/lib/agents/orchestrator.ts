/**
 * The agent team's run loop.
 *
 * For each queued task:
 *  1. Worker agents run in order on one shared draft. Each sees the task, Tom's answers,
 *     earlier actions, lessons from Tom's corrections, facts from WSCIP and Payroll Command
 *     Center, and any reviewer feedback, and returns the complete updated draft.
 *  2. An agent that is blocked raises questions; the task pauses as needs_input.
 *  3. Reviewers score the draft. Below the threshold it goes back to the workers with the
 *     feedback, up to max_revisions times.
 *  4. The final draft is saved as proposed actions; the task becomes ready. If the reviewers
 *     never approved, the actions are still saved but flagged.
 */
import { json, one, q, type Row } from '../db'
import { completeJson, LLMError } from '../llm'
import { londonToday } from '../dates'
import {
  CAPTURE_PROMPT, DEFAULT_AGENTS, DEFAULT_HOUSE_RULES, DEFAULTS_VERSION, REVIEWER_CONTRACT,
  REVIEWER_CONTRACT_NO_QUESTIONS, WORKER_CONTRACT, WORKER_CONTRACT_NO_QUESTIONS,
} from './defaults'
import { lessonsForContext } from './lessons'
import { gatherFacts } from './sources'

export const ACTION_KINDS = new Set(['email_draft', 'document', 'checklist', 'decision', 'call', 'delegate', 'note'])

export type Pipeline = {
  max_revisions: number; approval_threshold: number; max_questions_per_run: number; auto_run: boolean
  house_rules: string; team_directory: string; defaults_version: number; stale_days: number
  lessons_in_context: number; brief_enabled: boolean; brief_time: string; brief_weekends: boolean
  last_brief_date: string | null; work_start: string; work_end: string; focus_minutes: number; use_ws_systems: boolean
}
export type Agent = {
  id: string; name: string; role: 'worker' | 'reviewer'; description: string; instructions: string
  provider: string; model: string | null; temperature: number; position: number; enabled: boolean; can_ask_questions: boolean
}
type Draft = { kind: string; title: string; content: string; details: Record<string, unknown> }
type AskedQuestion = { question: string; why: string }

// ---------------------------------------------------------------- setup

export async function seedDefaults(force = false): Promise<void> {
  if (force) await q(`DELETE FROM agents`)
  await q(`INSERT INTO pipeline (id, house_rules) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`, [DEFAULT_HOUSE_RULES])
  const p = (await one<{ defaults_version: number }>(`SELECT defaults_version FROM pipeline WHERE id = 1`))!
  const existing = await q<{ name: string; role: string; position: number }>(`SELECT name, role, position FROM agents`)
  const fresh = force || existing.length === 0
  const seen = force ? 0 : p.defaults_version
  if (!fresh && seen >= DEFAULTS_VERSION) return
  const names = new Set(existing.map((a) => a.name))
  const lowest = Math.min(0, ...existing.filter((a) => a.role === 'worker').map((a) => a.position))
  for (const spec of DEFAULT_AGENTS) {
    if (names.has(spec.name) || (!fresh && spec.since <= seen)) continue
    await q(
      `INSERT INTO agents (name, role, description, instructions, temperature, position, enabled, can_ask_questions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [spec.name, spec.role, spec.description, spec.instructions, spec.temperature,
        fresh ? spec.position : lowest - 1, spec.enabled, spec.can_ask_questions],
    )
  }
  await q(`UPDATE pipeline SET defaults_version = $1 WHERE id = 1`, [DEFAULTS_VERSION])
}

export async function getPipeline(): Promise<Pipeline> {
  let p = await one<Pipeline>(`SELECT * FROM pipeline WHERE id = 1`)
  if (!p) {
    await seedDefaults()
    p = (await one<Pipeline>(`SELECT * FROM pipeline WHERE id = 1`))!
  }
  return p
}

export async function team(role: 'worker' | 'reviewer'): Promise<Agent[]> {
  return q<Agent>(`SELECT * FROM agents WHERE role = $1 AND enabled ORDER BY position, created_at`, [role])
}

export async function logEvent(taskId: string, kind: string, actor: string, content: unknown, attempt = 0) {
  await q(`INSERT INTO events (task_id, kind, actor, attempt, content) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [taskId, kind, actor, attempt, json(content)])
}

// ---------------------------------------------------------------- cleaning model output

export function cleanActions(raw: unknown): Draft[] | null {
  if (!Array.isArray(raw)) return null
  const out: Draft[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || !(item as any).title) continue
    const a = item as any
    const kind = String(a.kind || 'note').toLowerCase()
    out.push({
      kind: ACTION_KINDS.has(kind) ? kind : 'note',
      title: String(a.title).slice(0, 500),
      content: String(a.content ?? ''),
      details: a.details && typeof a.details === 'object' && !Array.isArray(a.details) ? a.details : {},
    })
  }
  return out
}

export function cleanQuestions(raw: unknown): AskedQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: AskedQuestion[] = []
  for (const qn of raw) {
    if (typeof qn === 'string' && qn.trim()) out.push({ question: qn.trim(), why: '' })
    else if (qn && typeof qn === 'object' && String((qn as any).question || '').trim()) {
      out.push({ question: String((qn as any).question).trim(), why: String((qn as any).why || '') })
    }
  }
  return out
}

// ---------------------------------------------------------------- context

export async function buildContext(task: Row, pipeline: Pipeline, facts: unknown) {
  const questions = await q(`SELECT question, answer, status FROM questions WHERE task_id = $1 ORDER BY created_at`, [task.id])
  const feedback = await q(`SELECT content FROM events WHERE task_id = $1 AND kind = 'feedback' ORDER BY created_at`, [task.id])
  const previous = await q(`SELECT title, kind, status, user_feedback FROM actions WHERE task_id = $1 AND status IN ('rejected','approved','done') ORDER BY position`, [task.id])
  const followUp = task.kind === 'follow_up' ? task.follow_up || {} : null
  return {
    task: { title: task.title, notes: task.notes || '', priority: task.priority, due_date: task.due_date, today: londonToday() },
    answered_questions: questions.filter((x) => x.status === 'answered').map((x) => ({ question: x.question, answer: x.answer })),
    questions_tom_declined: questions.filter((x) => x.status === 'dismissed').map((x) => x.question),
    tom_feedback: feedback.map((e) => e.content?.text).filter(Boolean),
    previous_actions: previous.map((a) => ({ title: a.title, kind: a.kind, status: a.status, tom_feedback: a.user_feedback })),
    team_directory: pipeline.team_directory || '(not filled in yet: name roles rather than people)',
    lessons_from_tom: await lessonsForContext(pipeline.lessons_in_context),
    ...(facts ? { facts_from_ws_systems: facts } : {}),
    ...(followUp ? {
      this_is_a_follow_up: {
        owner: followUp.owner, handover_sent: followUp.handover,
        instruction: 'The work was delegated and has not come back. Draft a short, firm chaser to the owner (kind delegate, same owner, a new due date) and say what Tom should check.',
      },
    } : {}),
  }
}

const systemPrompt = (agent: Agent, houseRules: string, contract: string) =>
  `${agent.instructions.trim()}\n\nHouse rules:\n${(houseRules || '').trim()}\n${contract}`

// ---------------------------------------------------------------- the run

export async function runTask(taskId: string): Promise<string> {
  const pipeline = await getPipeline()
  const workers = await team('worker')
  const reviewers = await team('reviewer')
  if (!workers.length) throw new LLMError('No enabled worker agents. Turn one on in Agent team.')
  const task = (await one(`UPDATE tasks SET run_count = run_count + 1, last_run_at = now() WHERE id = $1 RETURNING *`, [taskId]))!

  const facts = await gatherFacts(task, pipeline)
  const context = await buildContext(task, pipeline, facts)
  let draft: Draft[] = []
  let reviewerFeedback: unknown = null
  let lastReview: { score: number | null; notes: string; actionFeedback: any[] } = { score: null, notes: '', actionFeedback: [] }
  let approved = reviewers.length === 0

  for (let attempt = 0; attempt <= pipeline.max_revisions; attempt++) {
    for (const agent of workers) {
      const payload = { ...context, draft_actions: draft, reviewer_feedback: reviewerFeedback, attempt,
        can_ask_questions: agent.can_ask_questions, you_are: agent.name }
      const started = Date.now()
      const reply = await completeJson({
        provider: agent.provider as any, model: agent.model, role: 'worker', temperature: agent.temperature, payload,
        system: systemPrompt(agent, pipeline.house_rules, agent.can_ask_questions ? WORKER_CONTRACT : WORKER_CONTRACT_NO_QUESTIONS),
      })
      const actions = cleanActions(reply.actions)
      if (actions) draft = actions
      if (reply.summary) await q(`UPDATE tasks SET summary = $2 WHERE id = $1`, [taskId, String(reply.summary)])
      await logEvent(taskId, 'worker', agent.name, { summary: reply.summary ?? null, actions, seconds: Math.round((Date.now() - started) / 100) / 10 }, attempt)
      const asked = agent.can_ask_questions ? cleanQuestions(reply.questions) : []
      if (asked.length) return pauseForInput(taskId, agent.name, asked, pipeline.max_questions_per_run, attempt)
    }

    if (!reviewers.length) break
    const verdicts: any[] = []
    for (const agent of reviewers) {
      const reply = await completeJson({
        provider: agent.provider as any, model: agent.model, role: 'reviewer', temperature: agent.temperature,
        system: systemPrompt(agent, pipeline.house_rules, agent.can_ask_questions ? REVIEWER_CONTRACT : REVIEWER_CONTRACT_NO_QUESTIONS),
        payload: { ...context, draft_actions: draft, attempt, approval_threshold: pipeline.approval_threshold, can_ask_questions: agent.can_ask_questions },
      })
      const score = Number.isFinite(Number(reply.score)) ? Number(reply.score) : 0
      const ok = String(reply.verdict || '').toLowerCase() === 'approve' && score >= pipeline.approval_threshold
      const verdict = { reviewer: agent.name, approved: ok, score, feedback: String(reply.feedback || ''),
        action_feedback: Array.isArray(reply.action_feedback) ? reply.action_feedback : [] }
      verdicts.push(verdict)
      await logEvent(taskId, 'review', agent.name, verdict, attempt)
      const asked = agent.can_ask_questions ? cleanQuestions(reply.questions) : []
      if (asked.length) return pauseForInput(taskId, agent.name, asked, pipeline.max_questions_per_run, attempt)
    }
    lastReview = {
      score: Math.min(...verdicts.map((v) => v.score)),
      notes: verdicts.filter((v) => v.feedback).map((v) => `${v.reviewer}: ${v.feedback}`).join('\n'),
      actionFeedback: verdicts.flatMap((v) => v.action_feedback),
    }
    if (verdicts.every((v) => v.approved)) {
      approved = true
      break
    }
    reviewerFeedback = { attempt, reviews: verdicts }
  }
  return saveActions(taskId, draft, approved, lastReview, pipeline.max_revisions)
}

async function pauseForInput(taskId: string, askedBy: string, asked: AskedQuestion[], limit: number, attempt: number): Promise<string> {
  const known = new Set((await q(`SELECT lower(trim(question)) AS k FROM questions WHERE task_id = $1`, [taskId])).map((r) => r.k))
  const toAsk = asked.slice(0, Math.max(limit, 1))
  for (const qn of toAsk) {
    if (known.has(qn.question.trim().toLowerCase())) continue
    await q(`INSERT INTO questions (task_id, asked_by, question, why) VALUES ($1, $2, $3, $4)`, [taskId, askedBy, qn.question, qn.why])
  }
  await logEvent(taskId, 'question', askedBy, { questions: toAsk }, attempt)
  const open = await one(`SELECT 1 FROM questions WHERE task_id = $1 AND status = 'open' LIMIT 1`, [taskId])
  if (!open) {
    // Every question was a repeat of one already answered or declined: flag it rather than loop.
    await q(`UPDATE tasks SET status = 'failed' WHERE id = $1`, [taskId])
    await logEvent(taskId, 'error', 'orchestrator', { error: 'The agents repeated questions that were already answered or declined. Add to the brief and run again.' })
    return 'failed'
  }
  await q(`UPDATE tasks SET status = 'needs_input' WHERE id = $1`, [taskId])
  return 'needs_input'
}

async function saveActions(taskId: string, draft: Draft[], approved: boolean,
  review: { score: number | null; notes: string; actionFeedback: any[] }, maxRevisions: number): Promise<string> {
  await q(`UPDATE actions SET status = 'superseded' WHERE task_id = $1 AND status = 'proposed'`, [taskId])
  const start = ((await one<{ n: number }>(`SELECT COALESCE(MAX(position), -1)::int AS n FROM actions WHERE task_id = $1`, [taskId]))!.n) + 1
  const notesByIndex = new Map<number, string[]>()
  for (const f of review.actionFeedback) {
    if (f && Number.isInteger(f.index)) notesByIndex.set(f.index, [...(notesByIndex.get(f.index) || []), String(f.note || '')])
  }
  for (const [i, item] of draft.entries()) {
    const notes = [review.notes, ...(notesByIndex.get(i) || [])].filter(Boolean).join('\n')
    await q(
      `INSERT INTO actions (task_id, position, kind, title, content, details, review_status, review_score, review_notes)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [taskId, start + i, item.kind, item.title, item.content, json(item.details), approved ? 'approved' : 'flagged', review.score, notes],
    )
  }
  const flag = approved ? null : `Reviewer did not approve after ${maxRevisions + 1} attempts. Check before using. ${review.notes}`.trim()
  const status = draft.length ? 'ready' : 'failed'
  await q(`UPDATE tasks SET status = $2, review_flag = $3 WHERE id = $1`, [taskId, status, flag])
  if (!draft.length) await logEvent(taskId, 'error', 'orchestrator', { error: 'The agents produced no actions.' })
  await logEvent(taskId, 'status', 'orchestrator', { status, approved, actions: draft.length })
  return status
}

// ---------------------------------------------------------------- capture

export async function splitCapture(text: string) {
  const pipeline = await getPipeline()
  let reply: any
  try {
    reply = await completeJson({
      provider: 'auto', role: 'capture', temperature: 0.2,
      system: `${CAPTURE_PROMPT}\n\nHouse rules:\n${pipeline.house_rules}`,
      payload: { brain_dump: text, today: londonToday() },
    })
  } catch (e) {
    // Never lose a brain dump because the AI is down or misconfigured: one task per line instead.
    console.error('Capture split failed, falling back to lines', (e as Error).message)
    reply = { tasks: text.split('\n').map((l) => l.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim()).filter(Boolean).map((title) => ({ title })) }
  }
  const out: { title: string; notes: string; priority: number; due_date: string | null }[] = []
  for (const t of Array.isArray(reply.tasks) ? reply.tasks : []) {
    if (!t || !String(t.title || '').trim()) continue
    const pr = parseInt(t.priority, 10)
    const due = typeof t.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null
    out.push({ title: String(t.title).trim().slice(0, 500), notes: String(t.notes || ''), priority: Number.isFinite(pr) ? Math.min(Math.max(pr, 1), 3) : 2, due_date: due })
  }
  return out
}

// ---------------------------------------------------------------- queue

/** Atomically move one queued task to processing, so two runs never work the same task. */
export async function claimNext(): Promise<string | null> {
  const row = await one<{ id: string }>(
    `UPDATE tasks SET status = 'processing', claimed_at = now()
     WHERE id = (SELECT id FROM tasks WHERE status = 'queued' ORDER BY priority, created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id`)
  return row?.id ?? null
}

export async function processOne(taskId: string): Promise<void> {
  try {
    await runTask(taskId)
  } catch (e) {
    await q(`UPDATE tasks SET status = 'failed' WHERE id = $1`, [taskId])
    await logEvent(taskId, 'error', 'orchestrator', { error: String((e as Error).message || e).slice(0, 2000) })
    console.error('Agent run failed', taskId, e)
  }
}

/** A run that died mid-task (function timeout) goes back to the queue. */
export async function releaseStale(minutes = 20): Promise<number> {
  const rows = await q(`UPDATE tasks SET status = 'queued' WHERE status = 'processing' AND claimed_at < now() - ($1 || ' minutes')::interval RETURNING id`, [String(minutes)])
  return rows.length
}

/** Work the queue until it is empty, the limit is hit, or the time budget runs out. */
export async function processQueue(opts: { limit?: number; budgetMs?: number } = {}): Promise<number> {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000)
  let done = 0
  while (done < (opts.limit ?? 20) && Date.now() < deadline) {
    const id = await claimNext()
    if (!id) break
    await processOne(id)
    done++
  }
  return done
}
