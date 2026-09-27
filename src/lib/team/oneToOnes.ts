/**
 * Direct reports and 1-2-1 prep.
 *
 * - Each report has a running list of points for the next 1-2-1: focus points Tom wants to raise, and tasks that have
 *   cropped up (linked to the task list, so the prep shows where each one stands).
 * - Open tasks that mention a report by first name, or are handed over to them, are offered as "cropped up": one click
 *   adds them, or Tom dismisses them and they are not offered again.
 * - Aimelia writes the prep sheet from all of it, in a coaching voice. When the 1-2-1 is held, the points it covered are
 *   closed, the rest carry over, Tom's notes are kept (and learned from), and the next date is set.
 */
import { iso, json, one, q, type Row } from '../db'
import { addDays, londonToday } from '../dates'
import { complete } from '../llm'
import { fail } from '../http'
import { memoryForContext, keepNote } from '../memory/store'

/** Tom's direct reports, seeded once on first use. */
export const DEFAULT_REPORTS: { name: string; area: string }[] = [
  { name: 'James', area: 'Commercial' },
  { name: 'Danielle', area: 'Enablement' },
  { name: 'Natasha', area: 'Operations' },
  { name: 'David G', area: 'Development' },
  { name: 'Sandeep', area: 'Finance' },
]
export const POINT_KINDS = ['focus', 'task'] as const
export type PointKind = (typeof POINT_KINDS)[number]

/** One statement, so calls at the same moment (Ask Aimelia runs tools together) never see half the list. */
export async function seedReports() {
  await q(`WITH first AS (INSERT INTO app_config (key, value) VALUES ('reports_seeded', '1') ON CONFLICT (key) DO NOTHING RETURNING key)
    INSERT INTO reports (name, area, position) SELECT r.name, r.area, r.pos - 1 FROM first, unnest($1::text[], $2::text[]) WITH ORDINALITY AS r(name, area, pos)`,
  [DEFAULT_REPORTS.map((r) => r.name), DEFAULT_REPORTS.map((r) => r.area)])
}

export const reportOut = (r: Row) => ({
  id: r.id, name: r.name, area: r.area, email: r.email, notes: r.notes, position: r.position, active: r.active, every_days: r.every_days,
  last_held: r.last_held, next_on: r.next_on, prep: r.prep ?? null, prep_at: iso(r.prep_at),
})

export const pointOut = (p: Row) => ({
  id: p.id, report_id: p.report_id, kind: p.kind as PointKind, text: p.text, status: p.status as 'open' | 'discussed' | 'dropped' | 'dismissed',
  outcome: p.outcome, source: p.source, created_at: iso(p.created_at), discussed_at: iso(p.discussed_at),
  task: p.task_id ? { id: p.task_id, title: p.task_title ?? null, status: p.task_status ?? null, due_date: p.task_due ?? null } : null,
})

const POINT_SELECT = `SELECT rp.*, t.title AS task_title, t.status AS task_status, t.due_date AS task_due FROM report_points rp LEFT JOIN tasks t ON t.id = rp.task_id`

export const getReport = async (id: string) => (await one(`SELECT * FROM reports WHERE id::text = $1`, [id])) || fail(404, 'Not found.')

/** The first name, safe to put in a regular expression: "David G" matches on David. */
const firstName = (name: string) => (String(name).trim().split(/\s+/)[0] || '').replace(/[^\p{L}\p{N}'-]/gu, '')

/**
 * Open tasks that look like they belong on this report's agenda and are not on it yet (nor dismissed): the first name
 * as a whole word in the title or notes, or a handover to them.
 */
export async function croppedUp(r: Row, limit = 10) {
  const n = firstName(r.name)
  if (n.length < 2) return []
  const rows = await q(`SELECT t.id, t.title, t.status, t.due_date, t.priority FROM tasks t
    WHERE t.status <> 'done' AND (t.title ~* ('\\m' || $2 || '\\M') OR t.notes ~* ('\\m' || $2 || '\\M') OR t.follow_up->>'owner' ~* ('\\m' || $2 || '\\M'))
      AND NOT EXISTS (SELECT 1 FROM report_points rp WHERE rp.report_id = $1 AND rp.task_id = t.id)
    ORDER BY t.priority, t.due_date NULLS LAST, t.created_at DESC LIMIT $3`, [r.id, n, limit])
  return rows.map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date, priority: t.priority }))
}

export async function openPoints(reportId: string) {
  return (await q(`${POINT_SELECT} WHERE rp.report_id = $1 AND rp.status = 'open' ORDER BY rp.kind, rp.created_at`, [reportId])).map(pointOut)
}

export async function history(reportId: string, limit = 5) {
  return (await q(`SELECT * FROM one_to_ones WHERE report_id = $1 ORDER BY held_on DESC, created_at DESC LIMIT $2`, [reportId, limit]))
    .map((h) => ({ id: h.id, held_on: h.held_on, notes: h.notes, points: h.points || [] }))
}

/** A report with everything the page and the prep need. */
export async function reportView(r: Row) {
  const [points, cropped, held] = await Promise.all([openPoints(r.id), croppedUp(r), history(r.id)])
  return { ...reportOut(r), points, cropped_up: cropped, history: held }
}

/** Find a report by name, first name or area ("James", "commercial"), for Ask Aimelia. */
export async function findReport(who: string) {
  const w = String(who || '').trim().toLowerCase()
  if (!w) return null
  const all = await q(`SELECT * FROM reports WHERE active ORDER BY position, created_at`)
  return all.find((r) => r.name.toLowerCase() === w) || all.find((r) => r.area.toLowerCase() === w)
    || all.find((r) => firstName(r.name).toLowerCase() === w.split(/\s+/)[0]) || all.find((r) => r.area.toLowerCase().startsWith(w)) || null
}

export async function addPoint(reportId: string, o: { text?: string; kind?: string; task_id?: string | null; source?: string }) {
  let text = String(o.text || '').trim()
  let taskId: string | null = o.task_id || null
  if (taskId) {
    const t = await one(`SELECT id, title FROM tasks WHERE id::text = $1`, [taskId])
    if (!t) fail(404, 'Task not found.')
    taskId = t!.id
    if (!text) text = t!.title
    // A task already on the agenda is not added twice; a dismissed suggestion comes back as a point.
    const had = await one(`SELECT * FROM report_points WHERE report_id = $1 AND task_id = $2 AND status IN ('open', 'dismissed')`, [reportId, taskId])
    if (had) return (await one(`UPDATE report_points SET status = 'open', text = $2 WHERE id = $1 RETURNING *`, [had.id, had.status === 'dismissed' ? text : had.text]))!
  }
  if (!text) fail(400, 'Say what to raise.')
  const kind = POINT_KINDS.includes(o.kind as PointKind) ? o.kind : taskId ? 'task' : 'focus'
  return (await one(`INSERT INTO report_points (report_id, kind, text, task_id, source) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [reportId, kind, text.slice(0, 2000), taskId, (o.source || 'tom').slice(0, 40)]))!
}

/** Not for this report's agenda: it is not offered again. */
export async function dismissCroppedUp(reportId: string, taskId: string) {
  const t = await one(`SELECT id, title FROM tasks WHERE id::text = $1`, [taskId])
  if (!t) fail(404, 'Task not found.')
  await q(`INSERT INTO report_points (report_id, kind, text, task_id, status, source) VALUES ($1, 'task', $2, $3, 'dismissed', 'suggested')`, [reportId, t!.title, t!.id])
}

const PREP_PROMPT = `You prepare Tom Stanley for a 1-2-1 with one of his direct reports. Tom is founder, CEO and CFO of Williams, Stanley & Co,
a London accountancy firm for hospitality businesses ("the special forces of hospitality finance: clear, fast, elite").
He runs 1-2-1s as a coach: the report does most of the talking, Tom asks, listens, challenges and holds them to what they commit to.

Write the prep sheet from the facts given and nothing else. Never invent a figure, a task or an event.
Plain text, UK English, no markdown bold, no emojis, no em dashes. Short lines. Under 350 words. These headings, in order, each on its own line:
Open with: one line on what this 1-2-1 must achieve.
Recognise: what they have delivered or moved forward (from done or progressing tasks and last time's notes); say "Nothing on record" if none.
Focus points: each of Tom's focus points, with the one question that opens it up.
Tasks that have cropped up: each one with where it stands (status, due date) and what Tom needs from them on it.
Hold to: what they committed to last time, from the notes, and whether the record shows it done.
Coaching questions: three open questions that make them think (not yes or no), tied to their area.
Close with: the commitments to leave with (owner and date), and when the next 1-2-1 is.`

/** Write the prep sheet and keep it on the report. */
export async function writePrep(r: Row) {
  const view = await reportView(r)
  const [done, memory] = await Promise.all([
    firstName(r.name).length >= 2 ? q(`SELECT title, updated_at FROM tasks WHERE status = 'done' AND updated_at > now() - interval '45 days'
      AND (title ~* ('\\m' || $1 || '\\M') OR notes ~* ('\\m' || $1 || '\\M')) ORDER BY updated_at DESC LIMIT 10`, [firstName(r.name)]) : Promise.resolve([]),
    memoryForContext(`${r.name} ${r.area}`, 10),
  ])
  const payload = {
    person: { name: r.name, area: r.area, standing_notes: r.notes || null },
    today: londonToday(), last_1_2_1: r.last_held, next_1_2_1: r.next_on,
    focus_points: view.points.filter((p) => p.kind === 'focus').map((p) => p.text),
    tasks_cropped_up: view.points.filter((p) => p.kind === 'task').map((p) => ({ point: p.text, task: p.task ? { title: p.task.title, status: p.task.status, due: p.task.due_date } : null })),
    other_open_tasks_mentioning_them: view.cropped_up.map((t) => ({ title: t.title, status: t.status, due: t.due_date })),
    done_recently: done.map((t) => t.title),
    last_time: view.history[0] ? { held_on: view.history[0].held_on, notes: view.history[0].notes, covered: view.history[0].points } : null,
    what_aimelia_knows: memory,
  }
  const text = (await complete({ provider: 'auto', role: 'one_to_one', system: PREP_PROMPT, maxTokens: 2000, effort: 'medium', payload,
    messages: [{ role: 'user', content: JSON.stringify(payload, null, 1) }] })).trim()
  return (await one(`UPDATE reports SET prep = $2, prep_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [r.id, text]))!
}

/**
 * The 1-2-1 was held: the open points are closed as discussed, except those carried over; the notes are kept and learned
 * from; the next one is set (in every_days unless a date is given).
 */
export async function markHeld(r: Row, o: { notes?: string; carry_over?: string[]; held_on?: string; next_on?: string | null }) {
  const heldOn = o.held_on || londonToday()
  const keep = new Set(o.carry_over || [])
  const open = await q(`${POINT_SELECT} WHERE rp.report_id = $1 AND rp.status = 'open' ORDER BY rp.kind, rp.created_at`, [r.id])
  const covered = open.filter((p) => !keep.has(String(p.id)))
  if (covered.length) await q(`UPDATE report_points SET status = 'discussed', discussed_at = now() WHERE id = ANY($1::uuid[])`, [covered.map((p) => p.id)])
  const notes = String(o.notes || '').trim()
  const snapshot = covered.map((p) => ({ kind: p.kind, text: p.text, outcome: p.outcome || null, task: p.task_title ?? null, task_status: p.task_status ?? null }))
  await q(`INSERT INTO one_to_ones (report_id, held_on, notes, points) VALUES ($1, $2, $3, $4::jsonb)`, [r.id, heldOn, notes.slice(0, 20_000), json(snapshot)])
  const next = o.next_on === undefined ? addDays(heldOn, r.every_days || 14) : o.next_on
  if (notes) await keepNote('one_to_one', notes, { person: r.name, area: r.area, held_on: heldOn })
  return (await one(`UPDATE reports SET last_held = $2, next_on = $3, prep = NULL, prep_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`, [r.id, heldOn, next]))!
}
