/**
 * Agent Tasks API, mounted at /api/todo. Every endpoint needs the session cookie or X-Aimelia-Key.
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { iso, json, one, q, type Row } from '../db'
import { body, fail } from '../http'
import { availableProviders, DEFAULT_MODELS, resolveModel, resolveProvider } from '../llm'
import { addDays, isYmd, londonToday } from '../dates'
import { runLater, type Endpoint } from '../router'
import { connection, graph } from '../microsoft'
import { env } from '../env'
import { bookFocus, CalendarError } from './calendarBlocks'
import { learningStats, recordLesson } from './lessons'
import { buildBrief, channels, send } from './notify'
import { getPipeline, logEvent, processQueue, seedDefaults, splitCapture } from './orchestrator'
import { deferTask, firstDue, FOLLOW_UP_KINDS, scheduleFollowUp, touch, type Cadence } from './schedule'
import { csvItems, fingerprint, jobState, queueImport, recentJobs, runImportJobs, type JobKind, firefliesMeetings, importFireflies, importHistory, importTodo, listItems, saveImport, todoLists, type Saved } from './imports'
import { fileToText, ImportError, IMPORT_TYPES, isPdf } from './importText'
import { configuredSources, lookup } from './sources'
import { keepNote } from '../memory/store'
import { attachFiles, FILE_COLS, fileOut, readTaskFiles } from './documents'
import { answerQuestion, BLOCKING, dismissQuestion } from './questions'
import { memoryEndpoints } from '../memory/api'

// ---------------------------------------------------------------- schemas

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM')
const provider = z.enum(['auto', 'anthropic', 'openai', 'mock'])
const cadence = z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly'])

const TaskIn = z.object({ title: z.string().trim().min(1).max(500), notes: z.string().default(''), priority: z.number().int().min(1).max(3).default(2),
  due_date: ymd.nullable().optional(), run_now: z.boolean().default(true) })
const TaskPatch = z.object({ title: z.string().trim().min(1).max(500).optional(), notes: z.string().optional(), priority: z.number().int().min(1).max(3).optional(),
  due_date: ymd.nullable().optional(), status: z.enum(['done', 'queued']).optional() })
const Text = z.object({ text: z.string().trim().min(1) })
const Answer = z.object({ answer: z.string().trim().min(1) })
const ActionPatch = z.object({ title: z.string().optional(), content: z.string().optional(), details: z.record(z.string(), z.any()).optional() })
const Approve = z.object({ create_outlook_draft: z.boolean().default(false) })
const Done = z.object({ follow_up: z.boolean().default(true) })
const Reject = z.object({ reason: z.string().default(''), rework: z.boolean().default(true) })
const AgentIn = z.object({ name: z.string().trim().min(1).max(100), role: z.enum(['worker', 'reviewer']).default('worker'), description: z.string().default(''),
  instructions: z.string().trim().min(1), provider: provider.default('auto'), model: z.string().nullable().optional(), temperature: z.number().min(0).max(1).default(0.3),
  position: z.number().int().optional(), enabled: z.boolean().default(true), can_ask_questions: z.boolean().default(true) })
const AgentPatch = AgentIn.partial()
const Reorder = z.object({ ids: z.array(z.string()) })
const PipelinePatch = z.object({
  max_revisions: z.number().int().min(0).max(5), approval_threshold: z.number().min(0).max(10), max_questions_per_run: z.number().int().min(1).max(10),
  auto_run: z.boolean(), house_rules: z.string(), team_directory: z.string(), stale_days: z.number().int().min(0).max(365), follow_up_days: z.number().int().min(0).max(60),
  lessons_in_context: z.number().int().min(0).max(30), brief_enabled: z.boolean(), brief_time: hhmm, brief_weekends: z.boolean(),
  work_start: hhmm, work_end: hhmm, focus_minutes: z.number().int().min(15).max(480), use_ws_systems: z.boolean(),
}).partial()
const Capture = z.object({ text: z.string().trim().min(1).max(20000), run_now: z.boolean().default(true) })
const ImportText = z.object({ text: z.string().trim().min(1).max(200_000), kind: z.enum(['document', 'meeting', 'list']).default('meeting'),
  title: z.string().trim().max(300).default(''), run_now: z.boolean().default(true), force: z.boolean().default(false) })
// Vercel takes request bodies up to 4.5 MB, so files up to about 3 MB once base64 encoded.
const ImportFile = z.object({ filename: z.string().trim().min(1).max(300), data: z.string().min(1).max(4_200_000, 'that file is too big: keep it under 3 MB'),
  kind: z.enum(['document', 'meeting', 'list']).optional(), run_now: z.boolean().default(true), force: z.boolean().default(false) })
const ImportTodo = z.object({ list_ids: z.array(z.string().min(1)).min(1), run_now: z.boolean().default(true) })
const ImportAgain = z.object({ run_now: z.boolean().default(true), force: z.boolean().default(false) })
const Attach = z.object({ files: z.array(z.object({ name: z.string().trim().min(1).max(200), data: z.string().min(1) })).min(1).max(5),
  purpose: z.string().trim().max(1000).default(''), keep_in_knowledge: z.boolean().default(false), run_now: z.boolean().default(true) })
const FollowUp = z.object({ outcome: z.enum(['delivered', 'chase', 'snooze', 'now']), days: z.number().int().min(1).max(90).default(7) })
const Defer = z.object({ until: ymd, reason: z.string().default('') })
const Book = z.object({ minutes: z.number().int().min(15).max(480).optional() })
const RoutineIn = z.object({ title: z.string().trim().min(1).max(500), notes: z.string().default(''), priority: z.number().int().min(1).max(3).default(2),
  cadence: cadence.default('weekly'), weekday: z.number().int().min(0).max(6).default(0), day_of_month: z.number().int().min(-1).max(28).refine((v) => v !== 0, 'use 1-28 or -1').default(1),
  lead_days: z.number().int().min(0).max(30).default(3), enabled: z.boolean().default(true), next_due: ymd.nullable().optional() })
const RoutinePatch = RoutineIn.partial()
const LessonPatch = z.object({ active: z.boolean() })

// ---------------------------------------------------------------- serialisers

const TASK_SELECT = `SELECT t.*,
  (SELECT count(*)::int FROM questions qn WHERE qn.task_id = t.id AND qn.status IN ${BLOCKING}) AS open_questions,
  (SELECT count(*)::int FROM actions a WHERE a.task_id = t.id AND a.status = 'proposed') AS ready_actions FROM tasks t`

export function taskOut(t: Row) {
  return {
    id: t.id, title: t.title, notes: t.notes, priority: t.priority, due_date: t.due_date, status: t.status, summary: t.summary,
    review_flag: t.review_flag, run_count: t.run_count, last_run_at: iso(t.last_run_at), created_at: iso(t.created_at), updated_at: iso(t.updated_at),
    open_questions: t.open_questions ?? 0, ready_actions: t.ready_actions ?? 0, kind: t.kind, parent_id: t.parent_id, routine_id: t.routine_id,
    scheduled_for: t.scheduled_for, follow_up_owner: t.follow_up?.owner ?? null, follow_up_type: t.kind === 'follow_up' ? t.follow_up?.type || 'delegate' : null, calendar_event: t.calendar_event ?? null, stale_nudged_at: iso(t.stale_nudged_at),
    source: t.source ?? null,
  }
}
const questionOut = (x: Row) => ({ id: x.id, task_id: x.task_id, asked_by: x.asked_by, question: x.question, why: x.why, answer: x.answer, status: x.status,
  created_at: iso(x.created_at), updated_at: x.updated_at ? iso(x.updated_at) : null, answered_by: x.answered_by ?? null,
  suggested_answer: x.suggested_answer ?? null, suggested_from: x.suggested_from ?? null, also_for: x.also_for ?? [],
  // A merged question reads as the one it was merged into, which is what Tom answers.
  ...(x.status === 'merged' && x.shared_question ? { question: x.shared_question, why: x.shared_why || x.why, shared_with: { question_id: x.merged_into, task_id: x.shared_task_id, title: x.shared_task } } : {}) })
const actionOut = (a: Row) => ({ id: a.id, task_id: a.task_id, kind: a.kind, title: a.title, content: a.content, details: a.details || {}, status: a.status,
  review_status: a.review_status, review_score: a.review_score, review_notes: a.review_notes, user_feedback: a.user_feedback, created_at: iso(a.created_at),
  approved_at: a.approved_at ? iso(a.approved_at) : null, done_at: a.done_at ? iso(a.done_at) : null })
const eventOut = (e: Row) => ({ id: e.id, kind: e.kind, actor: e.actor, attempt: e.attempt, content: e.content, created_at: iso(e.created_at) })
const agentOut = (a: Row) => {
  const p = resolveProvider(a.provider)
  return { id: a.id, name: a.name, role: a.role, description: a.description, instructions: a.instructions, provider: a.provider, model: a.model,
    resolved_provider: p, resolved_model: resolveModel(p, a.model), temperature: a.temperature, position: a.position, enabled: a.enabled, can_ask_questions: a.can_ask_questions }
}
const pipelineOut = (p: Row) => ({
  max_revisions: p.max_revisions, approval_threshold: p.approval_threshold, max_questions_per_run: p.max_questions_per_run, auto_run: p.auto_run,
  house_rules: p.house_rules, team_directory: p.team_directory, stale_days: p.stale_days, follow_up_days: p.follow_up_days ?? 7, lessons_in_context: p.lessons_in_context,
  brief_enabled: p.brief_enabled, brief_time: p.brief_time, brief_weekends: p.brief_weekends, last_brief_date: p.last_brief_date,
  work_start: p.work_start, work_end: p.work_end, focus_minutes: p.focus_minutes, use_ws_systems: p.use_ws_systems,
})
const routineOut = (r: Row) => ({ id: r.id, title: r.title, notes: r.notes, priority: r.priority, cadence: r.cadence, weekday: r.weekday,
  day_of_month: r.day_of_month, lead_days: r.lead_days, next_due: r.next_due, enabled: r.enabled, created_count: r.created_count })
const lessonOut = (l: Row) => ({ id: l.id, source: l.source, action_kind: l.action_kind, task_title: l.task_title, before: l.before, after: l.after,
  note: l.note, active: l.active, created_at: iso(l.created_at) })

// ---------------------------------------------------------------- helpers

async function getTask(id: string): Promise<Row> {
  return (await one(`${TASK_SELECT} WHERE t.id = $1`, [id])) || fail(404, 'Task not found.')
}

export async function fullTask(id: string) {
  const t = await getTask(id)
  const [questions, actions, events] = await Promise.all([
    q(`SELECT qn.*, h.question AS shared_question, h.why AS shared_why, h.task_id AS shared_task_id, ht.title AS shared_task,
      COALESCE((SELECT json_agg(json_build_object('task_id', ct.id, 'title', ct.title) ORDER BY c.created_at) FROM questions c JOIN tasks ct ON ct.id = c.task_id
    WHERE c.merged_into = qn.id AND c.status = 'merged' AND c.task_id <> qn.task_id), '[]'::json) AS also_for
      FROM questions qn LEFT JOIN questions h ON h.id = qn.merged_into LEFT JOIN tasks ht ON ht.id = h.task_id
      WHERE qn.task_id = $1 ORDER BY qn.created_at`, [id]),
    q(`SELECT * FROM actions WHERE task_id = $1 AND status <> 'superseded' ORDER BY position`, [id]),
    q(`SELECT * FROM events WHERE task_id = $1 ORDER BY created_at`, [id]),
  ])
  const files = await q(`SELECT ${FILE_COLS} FROM task_files WHERE task_id = $1 ORDER BY created_at`, [id])
  return { ...taskOut(t), questions: questions.map(questionOut), actions: actions.map(actionOut), events: events.map(eventOut), files: files.map(fileOut) }
}

const kickQueue = (limit = 5) => runLater(() => processQueue({ limit }))

async function requeue(id: string, reason: string, run = true) {
  const t = await getTask(id)
  if (t.status === 'processing') fail(409, 'The agents are already working on this task.')
  await q(`UPDATE tasks SET status = 'queued' WHERE id = $1`, [id])
  await touch(id)
  await logEvent(id, 'status', 'tom', { status: 'queued', reason })
  if (run) kickQueue()
}

/** A pasted or uploaded list, taken line by line (or row by row for a CSV). Anything the AI reads is queued instead. */
function listImport(text: string, csv = false) {
  if (!text.trim()) fail(422, 'There is no text in that to read.')
  const items = csv ? csvItems(text) : listItems(text)
  if (!items.length) fail(422, 'No tasks found in that list.')
  return items
}

/** Queue an AI read and start it after the response: 202 with the job, or 409 when it was imported before. */
async function queueReply(o: Parameters<typeof queueImport>[0]) {
  const r = await queueImport(o)
  if (r.duplicate) return importReply(r, false)
  runLater(async () => {
    const started = Date.now()
    const done = await runImportJobs()
    // Triage gets only what is left of the five minutes, so a task is never cut off mid-run.
    const left = 270_000 - (Date.now() - started)
    if (done.runNow && left > 30_000) await processQueue({ limit: 20, budgetMs: left - 30_000 })
  })
  return Response.json({ job: jobState((await one(`SELECT * FROM import_jobs WHERE id = $1`, [r.id]))!) }, { status: 202 })
}

/** What an import endpoint answers: the new tasks, or 409 saying when it was imported before. */
function importReply(saved: Saved, runNow: boolean) {
  if (saved.duplicate) {
    return Response.json({ detail: `Already imported${saved.imported_at ? ` on ${saved.imported_at.slice(0, 10)}` : ''} as ${saved.task_count} task${saved.task_count === 1 ? '' : 's'}. Import it again only if you mean to.`,
      duplicate: true, imported_at: saved.imported_at, task_count: saved.task_count }, { status: 409 })
  }
  if (runNow) kickQueue(20)
  return Response.json(saved.tasks.map(taskOut), { status: 201 })
}

/**
 * Approved is decided, not done. Emails, calls, handovers, documents and checklists wait in To do until Tom
 * marks them done; decisions and notes are settled by approving them.
 */
export const TO_DO_KINDS = new Set(['email_draft', 'call', 'delegate', 'document', 'checklist'])

/** Nothing left to approve: the task is with Tom to do while approved actions wait, and done when none do. */
async function closeIfSettled(taskId: string) {
  const r = await one(`UPDATE tasks SET status = CASE WHEN EXISTS (SELECT 1 FROM actions WHERE task_id = $1 AND status = 'approved') THEN 'doing' ELSE 'done' END
           WHERE id = $1 AND status IN ('ready','doing')
           AND NOT EXISTS (SELECT 1 FROM actions WHERE task_id = $1 AND status = 'proposed') RETURNING status`, [taskId])
  if (r?.status === 'done') await logEvent(taskId, 'status', 'aimelia', { status: 'done', reason: 'every action is done' })
}

const taskStatus = async (id: string) => (await one(`SELECT status FROM tasks WHERE id = $1`, [id]))!.status as string

async function teamPayload() {
  await seedDefaults()
  const agents = await q(`SELECT * FROM agents ORDER BY role DESC, position, created_at`)
  return { agents: agents.map(agentOut), pipeline: pipelineOut(await getPipeline()), providers: availableProviders(),
    default_models: DEFAULT_MODELS, channels: channels(), sources: configuredSources() }
}

export const SUGGESTED_ROUTINES = [
  { title: 'Prepare the monthly board pack', cadence: 'monthly', day_of_month: 10, weekday: 0, lead_days: 5, priority: 1,
    notes: "Firm P&L against budget and last year, cash position and forecast, client wins and losses, people, risks. Draft the covering commentary in Tom's voice." },
  { title: "Month-end review of the firm's numbers", cadence: 'monthly', day_of_month: 5, weekday: 0, lead_days: 2, priority: 1,
    notes: 'Revenue, WIP, debtors over 60 days, margin by service line. Flag anything that moved more than 10%.' },
  { title: 'Weekly figures review', cadence: 'weekly', weekday: 0, day_of_month: 1, lead_days: 1, priority: 2,
    notes: "Last week's key figures and the three things to act on this week." },
  { title: 'Prepare one-to-ones with the leadership team', cadence: 'fortnightly', weekday: 3, day_of_month: 1, lead_days: 2, priority: 2,
    notes: 'For each direct report: open actions, wins, concerns from the systems, and three coaching questions.' },
  { title: 'Quarterly client review round', cadence: 'quarterly', day_of_month: 15, weekday: 0, lead_days: 7, priority: 2,
    notes: 'Top clients by revenue: margin trend, service issues, compliance position, renewal risk, a talking point each.' },
]

// ---------------------------------------------------------------- endpoints

export const todoEndpoints: Endpoint[] = [
  ['GET', '/briefing', async () => {
    await seedDefaults()
    const [questions, actions, failed, followUps, upcoming, toDo, counts] = await Promise.all([
      // One entry per open question, with the other tasks it also holds. It shows while any of them waits on Tom.
      q(`SELECT qn.*, t.title AS task_title, t.priority AS task_priority,
        COALESCE((SELECT json_agg(json_build_object('task_id', ct.id, 'title', ct.title) ORDER BY c.created_at) FROM questions c JOIN tasks ct ON ct.id = c.task_id
    WHERE c.merged_into = qn.id AND c.status = 'merged' AND c.task_id <> qn.task_id), '[]'::json) AS also_for
        FROM questions qn JOIN tasks t ON t.id = qn.task_id
        WHERE qn.status = 'open' AND (t.status = 'needs_input' OR EXISTS (SELECT 1 FROM questions c JOIN tasks ct ON ct.id = c.task_id
          WHERE c.merged_into = qn.id AND c.status = 'merged' AND ct.status = 'needs_input'))
        ORDER BY t.priority, t.created_at, qn.created_at`),
      q(`SELECT a.*, t.title AS task_title, t.review_flag AS task_review_flag FROM actions a JOIN tasks t ON t.id = a.task_id WHERE a.status = 'proposed' AND t.status = 'ready' ORDER BY t.priority, t.created_at, a.position`),
      q(`${TASK_SELECT} WHERE t.status = 'failed' ORDER BY t.updated_at DESC`),
      q(`${TASK_SELECT} WHERE t.status = 'due' ORDER BY t.due_date`),
      q(`${TASK_SELECT} WHERE t.kind = 'follow_up' AND t.status = 'scheduled' ORDER BY t.scheduled_for, t.created_at LIMIT 50`),
      q(`SELECT a.*, t.title AS task_title FROM actions a JOIN tasks t ON t.id = a.task_id
         WHERE a.status = 'approved' AND t.status <> 'done' ORDER BY t.priority, a.approved_at NULLS FIRST, a.position`),
      q(`SELECT status, count(*)::int AS n FROM tasks GROUP BY status`),
    ])
    const memoryQuestions = (await one(`SELECT count(*)::int AS n FROM memory_questions WHERE status = 'open'`))?.n ?? 0
    const c: Record<string, number> = { queued: 0, processing: 0, needs_input: 0, ready: 0, doing: 0, failed: 0, done: 0, scheduled: 0, due: 0 }
    for (const r of counts) c[r.status] = r.n
    return {
      generated_at: new Date().toISOString(), counts: c,
      questions: questions.map((x) => ({ ...questionOut(x), task_title: x.task_title })),
      actions: actions.map((a) => ({ ...actionOut(a), task_title: a.task_title, task_review_flag: a.task_review_flag })),
      failed: failed.map(taskOut), follow_ups: followUps.map((t) => ({ ...taskOut(t), handover: t.follow_up?.handover ?? null })),
      upcoming_follow_ups: upcoming.map(taskOut),
      to_do: toDo.map((a) => ({ ...actionOut(a), task_title: a.task_title })),
      providers: availableProviders(), channels: channels(), sources: configuredSources(), memory_questions: memoryQuestions,
    }
  }],

  ['GET', '/tasks', async (req) => {
    const u = new URL(req.url)
    const status = u.searchParams.get('status')
    const includeDone = u.searchParams.get('include_done') === 'true'
    const rows = status ? await q(`${TASK_SELECT} WHERE t.status = $1 ORDER BY t.priority, t.created_at DESC`, [status])
      : await q(`${TASK_SELECT} ${includeDone ? '' : `WHERE t.status <> 'done'`} ORDER BY t.priority, t.created_at DESC`)
    return rows.map(taskOut)
  }],
  ['POST', '/tasks', async (req) => {
    const b = await body(req, TaskIn)
    await seedDefaults()
    const t = (await one(`INSERT INTO tasks (title, notes, priority, due_date, last_touched_at) VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [b.title, b.notes, b.priority, b.due_date ?? null]))!
    if (b.notes.trim()) await keepNote('task_brief', `${b.title}\n\n${b.notes}`, { task: b.title }, `task:${t.id}`)
    if (b.run_now) kickQueue()
    return Response.json(await fullTask(t.id), { status: 201 })
  }],
  ['POST', '/capture', async (req) => {
    const b = await body(req, Capture)
    await seedDefaults()
    await keepNote('brain_dump', b.text, {}, `dump:${fingerprint(b.text)}`)
    const items = await splitCapture(b.text)
    if (!items.length) fail(422, 'No tasks found in that text.')
    const made = []
    for (const it of items) {
      made.push(await one(`INSERT INTO tasks (title, notes, priority, due_date, last_touched_at) VALUES ($1, $2, $3, $4, now()) RETURNING *`,
        [it.title, it.notes, it.priority, it.due_date]))
    }
    if (b.run_now) kickQueue(20)
    return Response.json(made.map((t) => taskOut(t!)), { status: 201 })
  }],

  // ---------------------------------------------------------------- imports: documents, meeting notes, Fireflies, Microsoft To Do
  ['GET', '/import', async () => {
    const ms = await connection().catch(() => ({ configured: false, connected: false }))
    return { file_types: IMPORT_TYPES, microsoft_todo: { configured: ms.configured, connected: ms.connected }, fireflies: !!env.firefliesKey(),
      jobs: await recentJobs(), ...(await importHistory()) }
  }],
  ['POST', '/import/text', async (req) => {
    const b = await body(req, ImportText)
    await seedDefaults()
    const title = b.title || (b.kind === 'list' ? 'Pasted list' : 'Pasted notes')
    if (b.kind !== 'list') return queueReply({ kind: b.kind, title, ref: fingerprint(b.text), text: b.text, force: b.force, runNow: b.run_now })
    const items = listImport(b.text)
    return importReply(await saveImport({ source: b.kind, ref: fingerprint(b.text), title, items, force: b.force }), b.run_now)
  }],
  ['POST', '/import/file', async (req) => {
    const b = await body(req, ImportFile)
    await seedDefaults()
    const buf = Buffer.from(b.data, 'base64')
    const title = b.filename.replace(/\.[a-z0-9]+$/i, '')
    let pdf = false
    try { pdf = isPdf(b.filename, buf) } catch (e) { fail(415, (e as Error).message) }
    if (pdf) {
      // Claude reads the PDF itself; a list PDF is still read for its tasks, one per item.
      return queueReply({ kind: b.kind === 'meeting' ? 'meeting' : 'document', title, ref: createHash('sha256').update(buf).digest('hex').slice(0, 32),
        pdf: buf.toString('base64'), force: b.force, runNow: b.run_now })
    }
    let text: string
    try { text = fileToText(b.filename, buf) } catch (e) {
      if (e instanceof ImportError) fail(415, e.message)
      fail(422, 'That file could not be read. If it is a Word document, open it and save it again as .docx.')
    }
    const csv = /\.csv$/i.test(b.filename)
    const kind = b.kind ?? (csv ? 'list' : /\.(vtt|srt)$/i.test(b.filename) ? 'meeting' : 'document')
    if (!text!.trim()) fail(422, 'There is no text in that to read.')
    if (kind !== 'list') return queueReply({ kind: kind as JobKind, title, ref: fingerprint(text!), text: text!, force: b.force, runNow: b.run_now })
    const items = listImport(text!, csv)
    return importReply(await saveImport({ source: kind, ref: fingerprint(text!), title, items, force: b.force }), b.run_now)
  }],
  ['GET', '/import/jobs/:id', async (_r, p) => {
    const j = (await one(`SELECT * FROM import_jobs WHERE id = $1`, [p.id])) || fail(404, 'Import not found.')
    const job = jobState(j!)
    const tasks = job.task_ids.length ? (await q(`${TASK_SELECT} WHERE t.id = ANY($1) ORDER BY t.created_at`, [job.task_ids])).map(taskOut) : []
    return { job, tasks }
  }],
  ['GET', '/import/todo/lists', async () => ({ lists: await todoLists() })],
  ['POST', '/import/todo', async (req) => {
    const b = await body(req, ImportTodo)
    await seedDefaults()
    const r = await importTodo(b.list_ids)
    if (b.run_now && r.tasks.length) kickQueue(20)
    return Response.json({ tasks: r.tasks.map(taskOut), skipped: r.skipped, lists: r.lists }, { status: 201 })
  }],
  ['GET', '/import/fireflies', async () => ({ meetings: await firefliesMeetings() })],
  ['POST', '/import/fireflies/:id', async (req, p) => {
    const b = await body(req, ImportAgain)
    await seedDefaults()
    return importReply(await importFireflies(p.id, b.force), b.run_now)
  }],

  ['GET', '/tasks/:id', async (_r, p) => fullTask(p.id)],
  ['POST', '/tasks/:id/files', async (req, p) => {
    const b = await body(req, Attach)
    const total = b.files.reduce((n, f) => n + f.data.length, 0)
    if (total > 4_200_000) fail(413, 'Those files are over 3 MB together. Attach them one at a time.')
    await getTask(p.id)
    const made = await attachFiles(p.id, b.files, { purpose: b.purpose, keep: b.keep_in_knowledge })
    // Read after the response; the agents get only what is left of the five minutes, so a run is never cut off.
    runLater(async () => {
      const started = Date.now()
      await readTaskFiles()
      const left = 270_000 - (Date.now() - started)
      if (b.run_now && left > 30_000) await processQueue({ limit: 5, budgetMs: left - 30_000 })
    })
    return Response.json({ files: made.map(fileOut), task: taskOut(await getTask(p.id)) }, { status: 201 })
  }],
  ['GET', '/tasks/:id/files/:file', async (_r, p) => {
    const f = (await one(`SELECT name, kind, media_type, data, text FROM task_files WHERE task_id::text = $1 AND id::text = $2`, [p.id, p.file])) || fail(404, 'Document not found.')
    const bytes = f!.data ? Buffer.from(f!.data, 'base64') : Buffer.from(String(f!.text || ''), 'utf8')
    const name = encodeURIComponent(f!.kind === 'text' ? `${f!.name}.txt` : f!.name)
    return new Response(bytes, { headers: { 'Content-Type': f!.kind === 'text' ? 'text/plain; charset=utf-8' : f!.media_type,
      'Content-Disposition': `${f!.kind === 'image' ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`, 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox" } })
  }],
  ['DELETE', '/tasks/:id/files/:file', async (_r, p) => {
    const r = await q(`DELETE FROM task_files WHERE task_id::text = $1 AND id::text = $2 RETURNING name`, [p.id, p.file])
    if (!r.length) fail(404, 'Document not found.')
    await q(`DELETE FROM kb_chunks WHERE source = 'policy' AND source_id = $1`, [`task-file-${p.file}`])
    await logEvent(p.id, 'documents', 'tom', { removed: r[0].name })
  }],
  ['PATCH', '/tasks/:id', async (req, p) => {
    const b = await body(req, TaskPatch)
    await getTask(p.id)
    const sets: string[] = []
    const vals: unknown[] = [p.id]
    for (const [k, v] of Object.entries(b)) { vals.push(v ?? null); sets.push(`${k} = $${vals.length}`) }
    if (sets.length) await q(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals)
    await touch(p.id)
    return fullTask(p.id)
  }],
  ['DELETE', '/tasks/:id', async (_r, p) => { await getTask(p.id); await q(`DELETE FROM tasks WHERE id = $1`, [p.id]) }],
  ['POST', '/tasks/:id/run', async (_r, p) => { await requeue(p.id, 'manual re-run'); return taskOut(await getTask(p.id)) }],
  ['POST', '/tasks/:id/feedback', async (req, p) => {
    const b = await body(req, Text)
    const t = await getTask(p.id)
    await logEvent(p.id, 'feedback', 'tom', { text: b.text })
    await recordLesson('feedback', { taskTitle: t.title, note: b.text })
    await keepNote('feedback', b.text, { task: t.title })
    await requeue(p.id, 'feedback')
    return fullTask(p.id)
  }],
  ['POST', '/tasks/:id/follow-up', async (req, p) => {
    const b = await body(req, FollowUp)
    const t = await getTask(p.id)
    if (t.kind !== 'follow_up') fail(400, 'This is not a follow-up.')
    await touch(p.id)
    if (b.outcome === 'delivered') {
      await q(`UPDATE tasks SET status = 'done' WHERE id = $1`, [p.id])
      await logEvent(p.id, 'status', 'tom', { status: 'done', reason: 'delivered' })
      if (t.parent_id) {
        const closed = await q(`UPDATE tasks SET status = 'done' WHERE id = $1 AND status <> 'done' RETURNING id`, [t.parent_id])
        if (closed.length) await logEvent(t.parent_id, 'status', 'tom', { status: 'done', reason: 'delegated work delivered' })
      }
    } else if (b.outcome === 'snooze') {
      await deferTask(p.id, addDays(londonToday(), b.days), 'More time given.')
    } else if (b.outcome === 'now') {
      if (t.status !== 'scheduled') fail(409, 'This check-in is not waiting.')
      await q(`UPDATE tasks SET status = 'due', scheduled_for = $2 WHERE id = $1`, [p.id, londonToday()])
      await logEvent(p.id, 'status', 'tom', { status: 'due', reason: 'brought forward' })
    } else {
      await requeue(p.id, 'not delivered: draft a chaser')
    }
    return fullTask(p.id)
  }],
  ['POST', '/tasks/:id/defer', async (req, p) => {
    const b = await body(req, Defer)
    const t = await getTask(p.id)
    if (t.status === 'processing') fail(409, 'The agents are working on this task. Try again in a moment.')
    await touch(p.id)
    await deferTask(p.id, b.until, b.reason)
    return fullTask(p.id)
  }],
  ['POST', '/tasks/:id/book', async (req, p) => {
    const b = await body(req, Book)
    const t = await getTask(p.id)
    const pl = await getPipeline()
    let event
    try {
      event = await bookFocus({ title: t.title, summary: t.summary || t.notes || '', minutes: b.minutes || pl.focus_minutes, workStart: pl.work_start, workEnd: pl.work_end })
    } catch (e) {
      if (e instanceof CalendarError) fail(409, e.message)
      throw e
    }
    await q(`UPDATE tasks SET calendar_event = $2::jsonb WHERE id = $1`, [p.id, json(event)])
    await touch(p.id)
    await logEvent(p.id, 'status', 'tom', { status: 'booked', reason: `focus time ${event!.start.replace('T', ' ')} to ${event!.end.slice(11)}` })
    return { task: taskOut(await getTask(p.id)), event }
  }],

  ['POST', '/questions/:id/answer', async (req, p) => {
    const b = await body(req, Answer)
    const r = (await answerQuestion(p.id, b.answer)) || fail(404, 'Question not found.')
    await keepNote('answer', b.answer, { question: r!.head.question, task: (await one(`SELECT title FROM tasks WHERE id = $1`, [r!.head.task_id]))?.title }, `question:${r!.head.id}`)
    const resumed = await settle(r!.tasks, 'questions answered')
    return { question: questionOut(r!.question), task_resumed: resumed.includes(r!.question.task_id), tasks_resumed: resumed.length }
  }],
  ['POST', '/questions/:id/dismiss', async (_r, p) => {
    const r = (await dismissQuestion(p.id)) || fail(404, 'Question not found.')
    const resumed = await settle(r!.tasks, 'questions dismissed')
    return { question: questionOut(r!.question), task_resumed: resumed.includes(r!.question.task_id), tasks_resumed: resumed.length }
  }],

  ['PATCH', '/actions/:id', async (req, p) => {
    const b = await body(req, ActionPatch)
    const a = (await one(`SELECT a.*, t.title AS task_title FROM actions a JOIN tasks t ON t.id = a.task_id WHERE a.id = $1`, [p.id])) || fail(404, 'Action not found.')
    if (b.content !== undefined && b.content.trim() !== String(a!.content || '').trim()) {
      // Tom rewriting the team's work is the clearest lesson there is.
      await recordLesson('edit', { taskTitle: a!.task_title, actionKind: a!.kind, before: a!.content, after: b.content })
      await q(`UPDATE actions SET edited = true WHERE id = $1`, [p.id])
      await logEvent(a!.task_id, 'status', 'tom', { status: 'edited', action: a!.title })
    }
    await q(`UPDATE actions SET title = COALESCE($2, title), content = COALESCE($3, content), details = COALESCE($4::jsonb, details), updated_at = now() WHERE id = $1`,
      [p.id, b.title ?? null, b.content ?? null, b.details ? json(b.details) : null])
    await touch(a!.task_id)
    return actionOut((await one(`SELECT * FROM actions WHERE id = $1`, [p.id]))!)
  }],
  ['POST', '/actions/:id/approve', async (req, p) => {
    const b = await body(req, Approve)
    const a = (await one(`SELECT * FROM actions WHERE id = $1`, [p.id])) || fail(404, 'Action not found.')
    const task = await getTask(a!.task_id)
    const d = a!.details || {}
    const result: Record<string, unknown> = {}
    if (b.create_outlook_draft) {
      if (a!.kind !== 'email_draft' || !d.to) fail(400, 'Only email drafts with a recipient can go to Outlook.')
      // A draft in Outlook, never sent. Mail.Send is not even requested.
      const draft = await graph('POST', '/me/messages', { body: {
        subject: d.subject || a!.title, body: { contentType: 'Text', content: a!.content }, categories: ['Drafted by Aimelia'],
        toRecipients: String(d.to).split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((address) => ({ emailAddress: { address } })),
        ...(d.cc ? { ccRecipients: String(d.cc).split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((address) => ({ emailAddress: { address } })) } : {}),
      } })
      result.draft_id = draft.id
      await q(`UPDATE actions SET details = details || $2::jsonb WHERE id = $1`, [p.id, json({ outlook_draft_id: draft.id })])
    }
    const toDo = TO_DO_KINDS.has(a!.kind)
    await q(`UPDATE actions SET status = $2, approved_at = now() WHERE id = $1`, [p.id, toDo ? 'approved' : 'done'])
    await touch(task.id)
    await logEvent(task.id, 'status', 'tom', { action: a!.title, status: 'approved', ...result })
    result.to_do = toDo
    const verdict = String(d.verdict || '').toLowerCase()
    if (a!.kind === 'decision' && verdict === 'defer') {
      const until = isYmd(d.revisit) ? d.revisit : addDays(londonToday(), 14)
      await q(`UPDATE actions SET status = 'superseded' WHERE task_id = $1 AND status = 'proposed'`, [task.id])
      await deferTask(task.id, until, "Triage recommended deferring.")
      result.deferred_to = until
    } else if (a!.kind === 'decision' && verdict === 'drop') {
      await q(`UPDATE actions SET status = 'superseded' WHERE task_id = $1 AND status = 'proposed'`, [task.id])
      await q(`UPDATE tasks SET status = 'done' WHERE id = $1`, [task.id])
      await logEvent(task.id, 'status', 'tom', { status: 'done', reason: "dropped on Triage's advice" })
    }
    await closeIfSettled(task.id)
    return { action: actionOut((await one(`SELECT * FROM actions WHERE id = $1`, [p.id]))!), task_status: await taskStatus(task.id), ...result }
  }],
  ['POST', '/actions/:id/reject', async (req, p) => {
    const b = await body(req, Reject)
    const a = (await one(`UPDATE actions SET status = 'rejected', user_feedback = NULLIF($2, '') WHERE id = $1 RETURNING *`, [p.id, b.reason])) || fail(404, 'Action not found.')
    const task = await getTask(a!.task_id)
    await touch(task.id)
    if (b.reason) await recordLesson('rejection', { taskTitle: task.title, actionKind: a!.kind, before: a!.content, note: b.reason })
    if (b.reason) await keepNote('send_back', b.reason, { task: task.title, draft: a!.title })
    await logEvent(task.id, 'feedback', 'tom', { text: `Rejected '${a!.title}'. ${b.reason}`.trim(), action_id: a!.id })
    if (b.rework) await requeue(task.id, 'action rejected')
    else await closeIfSettled(task.id)
    return { action: actionOut(a!), task_status: await taskStatus(task.id) }
  }],
  // Tom has carried it out. An email, call or handover then gets its check, unless he says none is needed.
  ['POST', '/actions/:id/done', async (req, p) => {
    const b = await body(req, Done)
    const a = (await one(`UPDATE actions SET status = 'done', done_at = now() WHERE id = $1 AND status IN ('approved','proposed') RETURNING *`, [p.id]))
      || ((await one(`SELECT id FROM actions WHERE id = $1`, [p.id])) ? fail(409, 'That action is already settled.') : fail(404, 'Action not found.'))
    const task = await getTask(a!.task_id)
    await touch(task.id)
    await logEvent(task.id, 'status', 'tom', { action: a!.title, status: 'done', ...(b.follow_up ? {} : { reason: 'no check needed' }) })
    const result: Record<string, unknown> = {}
    if (b.follow_up && FOLLOW_UP_KINDS[a!.kind]) {
      const follow = await scheduleFollowUp(task, a!, londonToday(), (await getPipeline()).follow_up_days ?? 7)
      if (follow) result.follow_up_on = follow.scheduled_for
    }
    await closeIfSettled(task.id)
    return { action: actionOut((await one(`SELECT * FROM actions WHERE id = $1`, [p.id]))!), task_status: await taskStatus(task.id), ...result }
  }],

  ['GET', '/agents', async () => teamPayload()],
  ['POST', '/agents', async (req) => {
    const b = await body(req, AgentIn)
    await seedDefaults() // a first custom agent must not suppress the default team
    const position = b.position ?? (await one<{ n: number }>(`SELECT count(*)::int AS n FROM agents WHERE role = $1`, [b.role]))!.n
    const a = (await one(`INSERT INTO agents (name, role, description, instructions, provider, model, temperature, position, enabled, can_ask_questions)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.name, b.role, b.description, b.instructions, b.provider, b.model || null, b.temperature, position, b.enabled, b.can_ask_questions]))!
    return Response.json(agentOut(a), { status: 201 })
  }],
  ['PATCH', '/agents/:id', async (req, p) => {
    const b = await body(req, AgentPatch)
    ;(await one(`SELECT id FROM agents WHERE id = $1`, [p.id])) || fail(404, 'Agent not found.')
    const sets: string[] = []
    const vals: unknown[] = [p.id]
    for (const [k, v] of Object.entries(b)) { vals.push(k === 'model' ? v || null : v); sets.push(`${k} = $${vals.length}`) }
    if (sets.length) await q(`UPDATE agents SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals)
    return agentOut((await one(`SELECT * FROM agents WHERE id = $1`, [p.id]))!)
  }],
  ['DELETE', '/agents/:id', async (_r, p) => { const r = await q(`DELETE FROM agents WHERE id = $1 RETURNING id`, [p.id]); if (!r.length) fail(404, 'Agent not found.') }],
  ['POST', '/agents/reorder', async (req) => {
    const b = await body(req, Reorder)
    for (const [i, id] of b.ids.entries()) await q(`UPDATE agents SET position = $2 WHERE id = $1`, [id, i])
    return teamPayload()
  }],
  ['POST', '/agents/reset', async () => { await seedDefaults(true); return teamPayload() }],
  ['PATCH', '/pipeline', async (req) => {
    const b = await body(req, PipelinePatch)
    await getPipeline()
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(b)) { vals.push(v); sets.push(`${k} = $${vals.length}`) }
    if (sets.length) await q(`UPDATE pipeline SET ${sets.join(', ')}, updated_at = now() WHERE id = 1`, vals)
    return pipelineOut(await getPipeline())
  }],
  ['POST', '/run', async () => { kickQueue(50); return { started: true } }],

  ['GET', '/routines', async () => {
    const rows = await q(`SELECT * FROM routines ORDER BY next_due`)
    const titles = new Set(rows.map((r) => r.title))
    return { routines: rows.map(routineOut), suggested: SUGGESTED_ROUTINES.filter((s) => !titles.has(s.title)) }
  }],
  ['POST', '/routines', async (req) => {
    const b = await body(req, RoutineIn)
    const next = b.next_due || firstDue(b.cadence as Cadence, b.weekday, b.day_of_month, londonToday())
    const r = (await one(`INSERT INTO routines (title, notes, priority, cadence, weekday, day_of_month, lead_days, enabled, next_due)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [b.title, b.notes, b.priority, b.cadence, b.weekday, b.day_of_month, b.lead_days, b.enabled, next]))!
    return Response.json(routineOut(r), { status: 201 })
  }],
  ['PATCH', '/routines/:id', async (req, p) => {
    const b = await body(req, RoutinePatch)
    const r = (await one(`SELECT * FROM routines WHERE id = $1`, [p.id])) || fail(404, 'Routine not found.')
    const merged = { ...r!, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) }
    if (['cadence', 'weekday', 'day_of_month'].some((k) => k in b) && !b.next_due) {
      merged.next_due = firstDue(merged.cadence, merged.weekday, merged.day_of_month, londonToday())
    }
    await q(`UPDATE routines SET title=$2, notes=$3, priority=$4, cadence=$5, weekday=$6, day_of_month=$7, lead_days=$8, enabled=$9, next_due=$10, updated_at=now() WHERE id=$1`,
      [p.id, merged.title, merged.notes, merged.priority, merged.cadence, merged.weekday, merged.day_of_month, merged.lead_days, merged.enabled, merged.next_due])
    return routineOut((await one(`SELECT * FROM routines WHERE id = $1`, [p.id]))!)
  }],
  ['DELETE', '/routines/:id', async (_r, p) => { const r = await q(`DELETE FROM routines WHERE id = $1 RETURNING id`, [p.id]); if (!r.length) fail(404, 'Routine not found.') }],

  ['GET', '/lessons', async () => ({ lessons: (await q(`SELECT * FROM lessons ORDER BY created_at DESC LIMIT 200`)).map(lessonOut), stats: await learningStats() })],
  ['PATCH', '/lessons/:id', async (req, p) => {
    const b = await body(req, LessonPatch)
    return lessonOut((await one(`UPDATE lessons SET active = $2 WHERE id = $1 RETURNING *`, [p.id, b.active])) || fail(404, 'Lesson not found.'))
  }],
  ['DELETE', '/lessons/:id', async (_r, p) => { const r = await q(`DELETE FROM lessons WHERE id = $1 RETURNING id`, [p.id]); if (!r.length) fail(404, 'Lesson not found.') }],

  ['POST', '/notify/test', async () => { const brief = await buildBrief(); return { brief, results: await send(brief) } }],
  ['POST', '/sources/test', async () => {
    const out: Record<string, string> = {}
    const probes = { wscip: 'recent_changes', pcc: 'payroll_clients' } as const
    for (const [s, ok] of Object.entries(configuredSources()) as ['wscip' | 'pcc', boolean][]) {
      if (!ok) { out[s] = 'not set up'; continue }
      try { await lookup(s, probes[s]); out[s] = 'connected' } catch (e) { out[s] = `failed: ${(e as Error).message}` }
    }
    return out
  }],
  ...memoryEndpoints,
]

/** After Tom settles a question: every task it held counts as touched, and those with nothing left open go back to the team. */
export async function settle(taskIds: string[], reason: string) {
  const resumed: string[] = []
  for (const id of taskIds) {
    await touch(id)
    if (await resumeIfAnswered(id, reason)) resumed.push(id)
  }
  return resumed
}

export async function resumeIfAnswered(taskId: string, reason: string): Promise<boolean> {
  const t = await getTask(taskId)
  if (t.status !== 'needs_input' || t.open_questions > 0) return false
  await requeue(taskId, reason)
  return true
}
