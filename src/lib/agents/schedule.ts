/**
 * Time-driven work: routines, deferred tasks, follow-ups on delegated work, and the rule
 * that old tasks go back through Triage. Run from the cron tick; every step is safe to repeat.
 */
import { json, one, q, type Row } from '../db'
import { addDays, addMonths, isYmd, londonToday, monthDay, ukDate, weekday, type Ymd } from '../dates'
import { logEvent } from './orchestrator'

export const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly'] as const
export type Cadence = (typeof CADENCES)[number]

/** Record that Tom did something with a task: resets the old-task clock. */
export async function touch(taskId: string) {
  await q(`UPDATE tasks SET last_touched_at = now(), stale_nudged_at = NULL, updated_at = now() WHERE id = $1`, [taskId])
}

export function firstDue(cadence: Cadence, wd: number, dom: number, today: Ymd): Ymd {
  if (cadence === 'weekly' || cadence === 'fortnightly') return addDays(today, (((wd - weekday(today)) % 7) + 7) % 7)
  const [y, m] = today.split('-').map(Number)
  const candidate = monthDay(y, m, dom)
  return candidate < today ? addMonths(candidate, 1, dom) : candidate
}

export function nextAfter(cadence: Cadence, current: Ymd, dom: number): Ymd {
  if (cadence === 'weekly') return addDays(current, 7)
  if (cadence === 'fortnightly') return addDays(current, 14)
  if (cadence === 'monthly') return addMonths(current, 1, dom)
  return addMonths(current, 3, dom)
}

/**
 * Create the task for each routine whose next occurrence is within its lead time. Occurrences
 * already missed are skipped, so a lapsed routine creates the next one, not a backlog.
 */
export async function createDueRoutines(today: Ymd = londonToday()): Promise<Row[]> {
  const made: Row[] = []
  for (const r of await q(`SELECT * FROM routines WHERE enabled`)) {
    const cadence = r.cadence as Cadence
    let due: Ymd = r.next_due
    if (addDays(due, -r.lead_days) > today) continue
    while (due < today) {
      const following = nextAfter(cadence, due, r.day_of_month)
      if (addDays(following, -r.lead_days) > today) break
      due = following
    }
    // Claim the occurrence first, so two ticks never create it twice.
    const claimed = await q(`UPDATE routines SET next_due = $3, created_count = created_count + 1, updated_at = now() WHERE id = $1 AND next_due = $2 RETURNING id`,
      [r.id, r.next_due, nextAfter(cadence, due, r.day_of_month)])
    if (!claimed.length) continue
    const task = (await one(`INSERT INTO tasks (title, notes, priority, due_date, status, kind, routine_id, last_touched_at)
      VALUES ($1, $2, $3, $4, 'queued', 'routine', $5, now()) RETURNING *`, [r.title, r.notes, r.priority, due, r.id]))!
    await logEvent(task.id, 'status', 'routine', { status: 'queued', reason: `${cadence} routine due ${ukDate(due)}` })
    made.push(task)
  }
  return made
}

/** After a handover is approved, park a check-in for its due date. */
export async function scheduleFollowUp(task: Row, action: Row, today: Ymd = londonToday()): Promise<Row> {
  const d = action.details || {}
  const owner = String(d.owner || 'the owner')
  const due: Ymd = isYmd(d.due) ? d.due : addDays(today, 7)
  const follow = (await one(
    `INSERT INTO tasks (title, notes, priority, due_date, scheduled_for, status, kind, parent_id, follow_up, last_touched_at)
     VALUES ($1, $2, $3, $4, $4, 'scheduled', 'follow_up', $5, $6::jsonb, now()) RETURNING *`,
    [`Check ${owner} delivered: ${task.title}`.slice(0, 500),
      `Handed to ${owner} on ${ukDate(today)}, due back ${ukDate(due)}.\n\nHandover sent:\n${action.content}`,
      task.priority, due, task.id, json({ owner, action_id: action.id, handover: action.content })],
  ))!
  await logEvent(follow.id, 'status', 'aimelia', { status: 'scheduled', reason: `follow-up on ${ukDate(due)}` })
  return follow
}

export async function deferTask(taskId: string, until: Ymd, reason: string, actor = 'tom') {
  await q(`UPDATE tasks SET status = 'scheduled', scheduled_for = $2 WHERE id = $1`, [taskId, until])
  await logEvent(taskId, 'status', actor, { status: 'scheduled', reason: `deferred to ${ukDate(until)}. ${reason}`.trim() })
}

/** Scheduled tasks whose date has come: follow-ups become due, everything else is queued. */
export async function wakeScheduled(today: Ymd = londonToday()): Promise<number> {
  const rows = await q(`UPDATE tasks SET status = CASE WHEN kind = 'follow_up' THEN 'due' ELSE 'queued' END
                        WHERE status = 'scheduled' AND scheduled_for <= $1 RETURNING id, status`, [today])
  for (const r of rows) await logEvent(r.id, 'status', 'aimelia', { status: r.status, reason: 'its date has come' })
  return rows.length
}

/** Tasks untouched for staleDays go back through Triage, told to delegate or drop. Once per period. */
export async function nudgeStale(staleDays: number, now: Date = new Date()): Promise<number> {
  if (!staleDays || staleDays <= 0) return 0
  const cutoff = new Date(now.getTime() - staleDays * 86400000).toISOString()
  const rows = await q(
    `SELECT id, COALESCE(last_touched_at, created_at) AS last FROM tasks
     WHERE status IN ('ready','needs_input','failed') AND COALESCE(last_touched_at, created_at) <= $1
       AND (stale_nudged_at IS NULL OR stale_nudged_at <= $1)`, [cutoff])
  for (const r of rows) {
    const days = Math.floor((now.getTime() - new Date(r.last).getTime()) / 86400000)
    await logEvent(r.id, 'feedback', 'aimelia', { text:
      `This task has sat untouched for ${days} days. Treat that as evidence it is not Tom's to do. ` +
      'Triage: the verdict must be DELEGATE or DROP unless there is a hard reason only Tom can do it, and say that reason.' })
    await q(`UPDATE questions SET status = 'dismissed' WHERE task_id = $1 AND status = 'open'`, [r.id])
    await q(`UPDATE tasks SET status = 'queued', stale_nudged_at = $2 WHERE id = $1`, [r.id, now.toISOString()])
  }
  return rows.length
}
