/**
 * The work planner: Tom's week, Monday to Friday.
 *
 * - Each day shows the minutes free after meetings (from Outlook busy times only: never subjects or attendees), the tasks
 *   planned for it, what is due, and what comes back that day. A day is over when its planned work exceeds its free time.
 * - Tasks without an estimate count as an hour.
 * - Plan my week: the AI proposes a day and an estimate for each open task within four fifths of the free time (a fifth is
 *   kept for what comes up), deadlines first, and says what should not happen this week. Without an AI, or if it fails,
 *   a plain plan does the same by due date then priority. Nothing changes until Tom uses the plan.
 */
import { iso, json, one, q, type Row } from '../db'
import { env } from '../env'
import { complete, parseJson } from '../llm'
import { graph } from '../microsoft'
import { addDays, londonParts, weekday } from '../dates'
import { getPipeline, logEvent } from '../agents/orchestrator'
import { PLAN_PROMPT } from '../agents/defaults'
import { dueBack, projectOut } from './projects'

export const DEFAULT_MINUTES = 60
const KEEP_FREE = 0.2
const clip = (t: unknown, n: number) => { const s = String(t ?? '').trim(); return s.length <= n ? s : `${s.slice(0, n)} ...` }

export const mondayOf = (day: string) => addDays(day, -weekday(day))
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** Busy minutes inside working hours, per day of the week, from Outlook. Null when Microsoft 365 is not connected. */
export async function busyByDay(monday: string, workStart: string, workEnd: string): Promise<Map<string, { busy: number; meetings: number }> | null> {
  let view: { value: any[] }
  try {
    view = await graph('GET', '/me/calendarView', {
      headers: { Prefer: `outlook.timezone="${env.timezone()}"` },
      query: { startDateTime: `${monday}T00:00:00`, endDateTime: `${addDays(monday, 5)}T00:00:00`, $select: 'start,end,showAs,isCancelled', $top: 500 },
    })
  } catch {
    return null // not set up or not connected: the planner works from working hours alone
  }
  const out = new Map<string, { busy: number; meetings: number }>()
  const [ws, we] = [toMin(workStart), toMin(workEnd)]
  const spans = new Map<string, [number, number][]>()
  for (const e of view.value || []) {
    if (e.isCancelled || ['free', 'workingElsewhere'].includes(e.showAs)) continue
    const s = String(e.start.dateTime), f = String(e.end.dateTime)
    const day = s.slice(0, 10)
    const a = Math.max(ws, toMin(s.slice(11, 16))), b = Math.min(we, f.slice(0, 10) > day ? we : toMin(f.slice(11, 16)))
    if (b > a) spans.set(day, [...(spans.get(day) || []), [a, b]])
    out.set(day, { busy: 0, meetings: (out.get(day)?.meetings || 0) + 1 })
  }
  for (const [day, list] of spans) {
    list.sort((x, y) => x[0] - y[0])
    let busy = 0, end = -1
    for (const [a, b] of list) { if (b <= end) continue; busy += b - Math.max(a, end); end = Math.max(end, b) }
    out.set(day, { busy, meetings: out.get(day)?.meetings || 0 })
  }
  return out
}

const planned = (t: Row) => t.estimate_minutes || DEFAULT_MINUTES
const OPEN = `status NOT IN ('done', 'scheduled')`

export const plannerTask = (t: Row) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, planned_for: t.planned_for,
  estimate_minutes: t.estimate_minutes, project_id: t.project_id, project: t.project_title ?? null, kind: t.kind, calendar_event: t.calendar_event ?? null })

/** The week as the planner shows it. */
export async function weekView(monday: string, now: Date = new Date()) {
  const pl = await getPipeline()
  const today = londonParts(now).date
  const days = Array.from({ length: 5 }, (_, i) => addDays(monday, i))
  const friday = days[4]
  const [busy, tasks, parked, back] = await Promise.all([
    busyByDay(monday, pl.work_start, pl.work_end),
    q(`SELECT t.*, p.title AS project_title FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.${OPEN} ORDER BY t.due_date NULLS LAST, t.priority, t.created_at LIMIT 300`),
    q(`SELECT id, title, scheduled_for FROM tasks WHERE status = 'scheduled' AND scheduled_for BETWEEN $1 AND $2`, [monday, friday]),
    q(`SELECT * FROM projects WHERE status IN ('active', 'someday') AND review_on BETWEEN $1 AND $2`, [monday, friday]),
  ])
  const work = toMin(pl.work_end) - toMin(pl.work_start)
  const out = days.map((day) => {
    const b = busy?.get(day)
    const free = Math.max(0, work - (b?.busy || 0))
    const onDay = tasks.filter((t) => t.planned_for === day)
    const minutes = onDay.reduce((n, t) => n + planned(t), 0)
    return {
      date: day, past: day < today, today: day === today,
      work_minutes: work, busy_minutes: busy ? b?.busy || 0 : null, meetings: busy ? b?.meetings || 0 : null, free_minutes: free,
      planned_minutes: minutes, over_by: Math.max(0, minutes - free),
      planned: onDay.map(plannerTask),
      due: tasks.filter((t) => t.due_date === day && t.planned_for !== day).map(plannerTask),
      coming_back: [...parked.filter((t) => t.scheduled_for === day).map((t) => ({ kind: 'task' as const, id: t.id, title: t.title })),
        ...back.filter((p) => p.review_on === day).map((p) => ({ kind: p.kind as 'project' | 'item', id: p.id, title: p.title }))],
    }
  })
  const unplanned = tasks.filter((t) => !t.planned_for || t.planned_for < monday || t.planned_for > friday)
  return {
    week: monday, today, calendar: !!busy, work_start: pl.work_start, work_end: pl.work_end, days: out,
    // Planned for a day that has passed and still open: slipped.
    slipped: tasks.filter((t) => t.planned_for && t.planned_for < today && t.planned_for >= monday).map(plannerTask),
    to_plan: unplanned.map((t) => ({ ...plannerTask(t), slipped: !!t.planned_for && t.planned_for < monday })),
    latest_plan: planOut(await one(`SELECT * FROM plans WHERE week = $1 AND status = 'proposed' ORDER BY created_at DESC LIMIT 1`, [monday])),
    due_back: (await dueBack(today)).map((p) => projectOut(p)),
  }
}

export type Proposal = { summary: string; plan: { task_id: string; day: string; minutes: number; why: string }[]; not_this_week: { task_id: string; why: string }[];
  warnings: string[]; by: 'ai' | 'plain' }

export const planOut = (p: Row | null) => (p ? { id: p.id, week: p.week, status: p.status, created_at: iso(p.created_at), ...(p.proposal as Proposal) } : null)

/** The plain plan: by due date, then priority, into the earliest day with room, never after the due day if it can be helped. */
export function plainPlan(tasks: Row[], room: Map<string, number>, days: string[]): Proposal {
  const left = new Map(room)
  const plan: Proposal['plan'] = []
  const notThisWeek: Proposal['not_this_week'] = []
  const warnings: string[] = []
  const order = [...tasks].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.priority - b.priority)
  for (const t of order) {
    const minutes = planned(t)
    const by = t.due_date && t.due_date <= days[days.length - 1] ? days.filter((d) => d <= t.due_date) : days
    const day = (by.length ? by : [days[0]]).find((d) => (left.get(d) || 0) >= minutes)
    if (day) {
      left.set(day, left.get(day)! - minutes)
      plan.push({ task_id: t.id, day, minutes, why: t.due_date && t.due_date <= days[days.length - 1] ? `due ${t.due_date}` : `priority ${t.priority}` })
    } else if (t.due_date && t.due_date <= days[days.length - 1]) {
      const d = by.length ? by[by.length - 1] : days[0]
      plan.push({ task_id: t.id, day: d, minutes, why: `due ${t.due_date}; no room, so this day is over` })
      left.set(d, (left.get(d) || 0) - minutes)
      warnings.push(`${clip(t.title, 80)} is due this week and does not fit: something else has to move.`)
    } else notThisWeek.push({ task_id: t.id, why: 'No room left this week.' })
  }
  const total = [...room.values()].reduce((a, b) => a + b, 0)
  const used = plan.reduce((a, p) => a + p.minutes, 0)
  return { by: 'plain', plan, not_this_week: notThisWeek, warnings,
    summary: `${plan.length} tasks planned into ${Math.round(used / 60)} of ${Math.round(total / 60)} hours you can plan this week${notThisWeek.length ? `; ${notThisWeek.length} do not fit` : ''}.` }
}

/** Propose a plan for the week, from today on. Stored, not applied. */
export async function planWeek(monday: string, now: Date = new Date()) {
  const view = await weekView(monday, now)
  const days = view.days.filter((d) => !d.past).map((d) => d.date)
  if (!days.length) return planOut(await one(`INSERT INTO plans (week, proposal) VALUES ($1, $2::jsonb) RETURNING *`,
    [monday, json({ by: 'plain', summary: 'This week is over. Plan next week instead.', plan: [], not_this_week: [], warnings: [] })]))
  // Room: four fifths of the free time; on today, only what is left of the working day.
  const nowMin = toMin(londonParts(now).time)
  const room = new Map(view.days.filter((d) => !d.past).map((d) => {
    const free = d.today ? Math.min(d.free_minutes, Math.max(0, toMin(view.work_end) - Math.max(nowMin, toMin(view.work_start)))) : d.free_minutes
    return [d.date, Math.round(free * (1 - KEEP_FREE))]
  }))
  const tasks = await q(`SELECT t.*, p.title AS project_title FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.${OPEN} AND t.status <> 'processing' ORDER BY t.due_date NULLS LAST, t.priority, t.created_at LIMIT 60`)
  const ids = new Set(tasks.map((t) => String(t.id)))
  let proposal: Proposal
  try {
    const raw = await complete({
      provider: 'auto', role: 'planner', temperature: 0.2, maxTokens: 6000, timeoutMs: 120_000, json: true, system: PLAN_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify({
        today: view.today,
        days: days.map((d) => ({ day: d, minutes_to_plan: room.get(d) })),
        tasks: tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, due: t.due_date, estimate: t.estimate_minutes, planned_for: t.planned_for,
          project: t.project_title || null, status: t.status, brief: clip(t.summary || t.notes, 200) })),
      }, null, 1) }],
      payload: { days, tasks: [...ids] },
    })
    const r = parseJson(raw)
    const seen = new Set<string>()
    const plan = (Array.isArray(r.plan) ? r.plan : []).filter((p: any) => ids.has(String(p?.task_id)) && days.includes(p?.day) && !seen.has(p.task_id) && seen.add(p.task_id))
      .map((p: any) => ({ task_id: String(p.task_id), day: p.day, minutes: Math.min(Math.max(Math.round(Number(p.minutes) || DEFAULT_MINUTES), 15), 480), why: clip(p.why, 200) }))
    if (!plan.length && tasks.length) throw new Error('the AI planned nothing')
    proposal = { by: 'ai', plan, summary: clip(r.summary, 800),
      not_this_week: (Array.isArray(r.not_this_week) ? r.not_this_week : []).filter((x: any) => ids.has(String(x?.task_id)) && !seen.has(x.task_id))
        .map((x: any) => ({ task_id: String(x.task_id), why: clip(x.why, 200) })),
      warnings: (Array.isArray(r.warnings) ? r.warnings : []).map((w: unknown) => clip(w, 300)).filter(Boolean).slice(0, 6) }
  } catch (e) {
    console.error('Planning with the AI failed, using the plain plan', (e as Error).message)
    proposal = plainPlan(tasks, room, days)
  }
  await q(`UPDATE plans SET status = 'replaced' WHERE week = $1 AND status = 'proposed'`, [monday])
  const titles = new Map(tasks.map((t) => [String(t.id), t.title]))
  proposal.plan = proposal.plan.map((p) => ({ ...p, title: titles.get(p.task_id) })) as any
  proposal.not_this_week = proposal.not_this_week.map((p) => ({ ...p, title: titles.get(p.task_id) })) as any
  return planOut(await one(`INSERT INTO plans (week, proposal) VALUES ($1, $2::jsonb) RETURNING *`, [monday, json(proposal)]))
}

/** Use a proposed plan: each task gets its day and, where it had none, the estimate. */
export async function applyPlan(id: string) {
  const p = await one(`UPDATE plans SET status = 'applied', applied_at = now() WHERE id::text = $1 AND status = 'proposed' RETURNING *`, [id])
  if (!p) return null
  let n = 0
  for (const item of (p.proposal as Proposal).plan) {
    const r = await q(`UPDATE tasks SET planned_for = $2, estimate_minutes = COALESCE(estimate_minutes, $3), updated_at = now()
      WHERE id::text = $1 AND status NOT IN ('done') RETURNING id`, [item.task_id, item.day, item.minutes])
    if (r.length) { n++; await logEvent(item.task_id, 'status', 'tom', { status: 'planned', reason: `for ${item.day}${item.why ? `: ${item.why}` : ''}` }) }
  }
  return { planned: n }
}
