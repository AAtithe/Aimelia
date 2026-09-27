/**
 * Direct reports and 1-2-1 prep.
 *
 * The list for each 1-2-1 builds itself from what Aimelia already holds, since the last 1-2-1 (or the last 30 days):
 * - open tasks that name the report (first name as a whole word in the title or notes, the owner an import named, or a
 *   handover to them), flagged when overdue, waiting on Tom, failed or gone quiet, and marked when new since last time
 * - their tasks done since last time, to recognise
 * - active projects that name them
 * - with their email address set: emails from them that need action, and meetings they were in
 * Tom adds his own focus points, links any other task, and removes anything that does not belong ("not for this 1-2-1").
 *
 * 1-2-1 notes are not kept here: the firm logs 1-2-1s in Employment Hero. Aimelia writes the prep sheet, Tom copies it
 * into Employment Hero, and marking the 1-2-1 done only closes his focus points and moves the dates on.
 */
import { iso, one, q, type Row } from '../db'
import { addDays, londonToday } from '../dates'
import { complete } from '../llm'
import { fail } from '../http'
import { memoryForContext } from '../memory/store'

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
const LOOKBACK_DAYS = 30
const QUIET_DAYS = 14

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
  source: p.source, created_at: iso(p.created_at),
  task: p.task_id ? { id: p.task_id, title: p.task_title ?? null, status: p.task_status ?? null, due_date: p.task_due ?? null } : null,
})

const POINT_SELECT = `SELECT rp.*, t.title AS task_title, t.status AS task_status, t.due_date AS task_due FROM report_points rp LEFT JOIN tasks t ON t.id = rp.task_id`

export const getReport = async (id: string) => (await one(`SELECT * FROM reports WHERE id::text = $1`, [id])) || fail(404, 'Not found.')

/** The first name, safe to put in a regular expression: "David G" matches on David. */
const firstName = (name: string) => (String(name).trim().split(/\s+/)[0] || '').replace(/[^\p{L}\p{N}'-]/gu, '')
/** Where a task names someone: title, notes (imports write "Owner named: ..."), or the owner of a handover. */
const NAMES = `(t.title ~* ('\\m' || $2 || '\\M') OR t.notes ~* ('\\m' || $2 || '\\M') OR t.follow_up->>'owner' ~* ('\\m' || $2 || '\\M'))`

/** The day the list runs from: the last 1-2-1, or LOOKBACK_DAYS ago. */
export const sinceOf = (r: Row) => r.last_held || addDays(londonToday(), -LOOKBACK_DAYS)

function flagOf(t: Row, today: string) {
  if (t.status === 'failed') return 'failed'
  if (t.status === 'needs_input') return 'waiting on you'
  if (t.due_date && t.due_date < today) return 'overdue'
  const touched = t.last_touched_at || t.updated_at
  if (touched && Date.now() - new Date(touched).getTime() > QUIET_DAYS * 86400000) return `no movement in ${QUIET_DAYS} days`
  return null
}

/** Everything the list picks up by itself for this report. */
export async function gathered(r: Row) {
  const n = firstName(r.name)
  const since = sinceOf(r)
  const today = londonToday()
  const email = String(r.email || '').trim().toLowerCase()
  const named = n.length >= 2
  const [open, done, projects, emails, meetings] = await Promise.all([
    named ? q(`SELECT t.* FROM tasks t WHERE t.status <> 'done' AND ${NAMES}
      AND NOT EXISTS (SELECT 1 FROM report_points rp WHERE rp.report_id = $1 AND rp.task_id = t.id AND rp.status IN ('open', 'dismissed'))
      ORDER BY t.priority, t.due_date NULLS LAST, t.created_at DESC LIMIT 25`, [r.id, n]) : [],
    named ? q(`SELECT t.id, t.title, t.updated_at FROM tasks t WHERE t.status = 'done' AND t.updated_at >= $3::date AND ${NAMES}
      AND NOT EXISTS (SELECT 1 FROM report_points rp WHERE rp.report_id = $1 AND rp.task_id = t.id AND rp.status = 'dismissed')
      ORDER BY t.updated_at DESC LIMIT 15`, [r.id, n, since]) : [],
    named ? q(`SELECT id, title, next_step, review_on FROM projects WHERE status = 'active'
      AND (title ~* ('\\m' || $1 || '\\M') OR notes ~* ('\\m' || $1 || '\\M') OR next_step ~* ('\\m' || $1 || '\\M') OR outcome ~* ('\\m' || $1 || '\\M'))
      ORDER BY review_on NULLS LAST LIMIT 10`, [n]) : [],
    email ? q(`SELECT subject, received_at, action_required, urgency FROM emails WHERE lower(from_email) = $1 AND received_at >= $2::date
      AND action_required IS NOT NULL ORDER BY urgency DESC, received_at DESC LIMIT 10`, [email, since]) : [],
    email ? q(`SELECT subject, start_at FROM meetings WHERE start_at >= $2::date AND start_at < now()
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(attendees) a WHERE lower(a) = $1) ORDER BY start_at DESC LIMIT 10`, [email, since]) : [],
  ])
  return {
    since,
    from_tasks: open.map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date, priority: t.priority,
      new_since_last: !!r.last_held && iso(t.created_at)!.slice(0, 10) > r.last_held, flag: flagOf(t, today) })),
    delivered: done.map((t) => ({ id: t.id, title: t.title, done_on: iso(t.updated_at)?.slice(0, 10) ?? null })),
    projects: projects.map((p) => ({ id: p.id, title: p.title, next_step: p.next_step, review_on: p.review_on })),
    emails: emails.map((e) => ({ subject: e.subject, received: iso(e.received_at)?.slice(0, 10) ?? null, action: e.action_required })),
    meetings: meetings.map((m) => ({ subject: m.subject, on: iso(m.start_at)?.slice(0, 10) ?? null })),
  }
}

export async function openPoints(reportId: string) {
  return (await q(`${POINT_SELECT} WHERE rp.report_id = $1 AND rp.status = 'open' ORDER BY rp.kind, rp.created_at`, [reportId])).map(pointOut)
}

async function listFor(r: Row) {
  const [points, auto] = await Promise.all([openPoints(r.id), gathered(r)])
  return { ...reportOut(r), points, ...auto }
}

/** A report with everything the page and the prep need, and the list as text for Employment Hero. */
export async function reportView(r: Row) {
  const v = await listFor(r)
  return { ...v, agenda: agendaText(v) }
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
    // A task already on the list is not added twice; one taken off comes back.
    const had = await one(`SELECT * FROM report_points WHERE report_id = $1 AND task_id = $2 AND status IN ('open', 'dismissed')`, [reportId, taskId])
    if (had) return (await one(`UPDATE report_points SET status = 'open', text = $2 WHERE id = $1 RETURNING *`, [had.id, had.status === 'dismissed' ? text : had.text]))!
  }
  if (!text) fail(400, 'Say what to raise.')
  const kind = POINT_KINDS.includes(o.kind as PointKind) ? o.kind : taskId ? 'task' : 'focus'
  return (await one(`INSERT INTO report_points (report_id, kind, text, task_id, source) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [reportId, kind, text.slice(0, 2000), taskId, (o.source || 'tom').slice(0, 40)]))!
}

/** Not for this report's 1-2-1s: never picked up for them again (and off the list if Tom had linked it). */
export async function dismissTask(reportId: string, taskId: string) {
  const t = await one(`SELECT id, title FROM tasks WHERE id::text = $1`, [taskId])
  if (!t) fail(404, 'Task not found.')
  const had = await one(`UPDATE report_points SET status = 'dismissed' WHERE report_id = $1 AND task_id = $2 AND status = 'open' RETURNING id`, [reportId, t!.id])
  if (!had) await q(`INSERT INTO report_points (report_id, kind, text, task_id, status, source) VALUES ($1, 'task', $2, $3, 'dismissed', 'auto')`, [reportId, t!.title, t!.id])
}

const PREP_PROMPT = `You prepare Tom Stanley for a 1-2-1 with one of his direct reports. Tom is founder, CEO and CFO of Williams, Stanley & Co,
a London accountancy firm for hospitality businesses ("the special forces of hospitality finance: clear, fast, elite").
He runs 1-2-1s as a coach: the report does most of the talking, Tom asks, listens, challenges and holds them to what they commit to.
The sheet is pasted into the 1-2-1 record in Employment Hero, so it must read cleanly as plain text.

Write it from the facts given and nothing else. Never invent a figure, a task or an event.
Plain text, UK English, no markdown bold, no emojis, no em dashes. Short lines. Under 350 words. These headings, in order, each on its own line:
Open with: one line on what this 1-2-1 must achieve.
Recognise: what they delivered since the last 1-2-1 (delivered); say "Nothing on record" if none.
Focus points: each of Tom's focus points, with the one question that opens it up.
Live work: the open tasks and projects, flagged ones first (overdue, waiting on Tom, failed, no movement), with what Tom needs from them on each. Mark the ones new since last time.
Hold to: open tasks that were already open at the last 1-2-1 (not new) and are still not done; say plainly what has not moved.
Coaching questions: three open questions that make them think (not yes or no), tied to their area and what the record shows.
Close with: the commitments to leave with (owner and date), and when the next 1-2-1 is.`

/** Write the prep sheet and keep it on the report until the 1-2-1 is done. */
export async function writePrep(r: Row) {
  const view = await reportView(r)
  const memory = await memoryForContext(`${r.name} ${r.area}`, 10)
  const payload = {
    person: { name: r.name, area: r.area, standing_notes: r.notes || null },
    today: londonToday(), since: view.since, last_1_2_1: r.last_held, next_1_2_1: r.next_on,
    focus_points: view.points.filter((p) => p.kind === 'focus').map((p) => p.text),
    tasks_tom_linked: view.points.filter((p) => p.kind === 'task').map((p) => ({ point: p.text, status: p.task?.status ?? null, due: p.task?.due_date ?? null })),
    open_tasks: view.from_tasks.map((t) => ({ title: t.title, status: t.status, due: t.due_date, flag: t.flag, new_since_last: t.new_since_last })),
    delivered: view.delivered.map((t) => t.title),
    projects: view.projects.map((p) => ({ title: p.title, next_step: p.next_step || null })),
    emails_needing_action: view.emails, meetings_together: view.meetings,
    what_aimelia_knows: memory,
  }
  const text = (await complete({ provider: 'auto', role: 'one_to_one', system: PREP_PROMPT, maxTokens: 2000, effort: 'medium', payload,
    messages: [{ role: 'user', content: JSON.stringify(payload, null, 1) }] })).trim()
  return (await one(`UPDATE reports SET prep = $2, prep_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [r.id, text]))!
}

/**
 * The 1-2-1 is done (and logged in Employment Hero). Tom's focus points and linked tasks are closed, except those carried
 * over; the list now runs from today, and the next one is set (in every_days unless a date is given). No notes are kept.
 */
export async function markHeld(r: Row, o: { carry_over?: string[]; held_on?: string; next_on?: string | null }) {
  const heldOn = o.held_on || londonToday()
  const keep = o.carry_over || []
  await q(`UPDATE report_points SET status = 'discussed', discussed_at = now() WHERE report_id = $1 AND status = 'open' AND NOT (id::text = ANY($2::text[]))`, [r.id, keep])
  const next = o.next_on === undefined ? addDays(heldOn, r.every_days || 14) : o.next_on
  return (await one(`UPDATE reports SET last_held = $2, next_on = $3, prep = NULL, prep_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`, [r.id, heldOn, next]))!
}

/** The list as plain text, for pasting into Employment Hero when there is no prep sheet. */
export function agendaText(v: Awaited<ReturnType<typeof listFor>>) {
  const block = (title: string, lines: string[]) => lines.length ? `${title}\n${lines.map((l) => `- ${l}`).join('\n')}` : ''
  return [
    `1-2-1: ${v.name}${v.area ? `, ${v.area}` : ''}${v.next_on ? ` (${v.next_on})` : ''}`,
    block('Recognise', v.delivered.map((t) => t.title)),
    block('Focus points', v.points.filter((p) => p.kind === 'focus').map((p) => p.text)),
    block('Live work', [
      ...v.points.filter((p) => p.kind === 'task').map((p) => `${p.text}${p.task?.status ? ` (${p.task.status})` : ''}`),
      ...v.from_tasks.map((t) => `${t.title} (${[t.status, t.due_date && `due ${t.due_date}`, t.flag, t.new_since_last && 'new'].filter(Boolean).join(', ')})`),
      ...v.projects.map((p) => `Project: ${p.title}${p.next_step ? `, next: ${p.next_step}` : ''}`),
    ]),
    block('Emails needing action', v.emails.map((e) => `${e.subject}: ${e.action}`)),
  ].filter(Boolean).join('\n\n')
}
