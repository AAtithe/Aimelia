/**
 * Time-driven work: routines, deferred tasks, follow-ups on delegated work, and the rule
 * that old tasks go back through Triage. Run from the cron tick; every step is safe to repeat.
 */
import { json, one, q, type Row } from '../db'
import { addDays, addMonths, isYmd, londonToday, monthDay, ukDate, weekday, type Ymd } from '../dates'
import { logEvent } from './orchestrator'
import { releaseTaskQuestions } from './questions'

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

export type FollowUpType = 'delegate' | 'email' | 'call'
/** Which approved actions need checking on later: work that has to come back from someone else. */
export const FOLLOW_UP_KINDS: Record<string, FollowUpType> = { delegate: 'delegate', email_draft: 'email', call: 'call' }

function followUpText(type: FollowUpType, owner: string, title: string, today: Ymd, due: Ymd, content: string) {
  if (type === 'email') return { title: `Check ${owner} replied: ${title}`, notes: `Email approved on ${ukDate(today)}. Check on ${ukDate(due)} that ${owner} has replied and it is settled.\n\nEmail approved:\n${content}` }
  if (type === 'call') return { title: `Check the call with ${owner} happened: ${title}`, notes: `Call approved on ${ukDate(today)}. Check on ${ukDate(due)} that it happened and anything from it is on the list.\n\nCall approved:\n${content}` }
  return { title: `Check ${owner} delivered: ${title}`, notes: `Handed to ${owner} on ${ukDate(today)}, due back ${ukDate(due)}.\n\nHandover sent:\n${content}` }
}

/**
 * After an email, call or handover is approved, park a check-in: a handover on its due date, an email or call
 * `days` later (a week by default). A task gets one check-in, not one per action: a second approval while one
 * is waiting is added to it. Returns null when follow-ups for that kind are switched off.
 */
export async function scheduleFollowUp(task: Row, action: Row, today: Ymd = londonToday(), days = 7): Promise<Row | null> {
  const type = FOLLOW_UP_KINDS[action.kind]
  if (!type || (type !== 'delegate' && days <= 0)) return null
  const d = action.details || {}
  const owner = String((type === 'email' ? d.to : type === 'call' ? d.with || d.who || d.attendees : d.owner) || (type === 'call' ? 'them' : 'the owner')).slice(0, 120)
  const due: Ymd = type === 'delegate' && isYmd(d.due) ? d.due : addDays(today, type === 'delegate' ? 7 : days)
  // A chaser approved on a check-in follows up on the original task.
  const parentId = task.kind === 'follow_up' && task.parent_id ? task.parent_id : task.id
  const item = { type, owner, action_id: action.id, title: action.title, content: action.content, approved: today }
  const waiting = await one(`SELECT * FROM tasks WHERE kind = 'follow_up' AND parent_id = $1 AND status IN ('scheduled','due') AND id <> $2
    ORDER BY created_at DESC LIMIT 1`, [parentId, task.id])
  if (waiting) {
    const f = waiting.follow_up || {}
    const items = [...(f.items || []), item]
    await q(`UPDATE tasks SET follow_up = $2::jsonb, notes = notes || $3, updated_at = now() WHERE id = $1`,
      [waiting.id, json({ ...f, items }), `\n\nAlso approved on ${ukDate(today)}: ${action.title}\n${action.content}`])
    await logEvent(waiting.id, 'status', 'aimelia', { status: waiting.status, reason: `also checking: ${action.title}` })
    return (await one(`SELECT * FROM tasks WHERE id = $1`, [waiting.id]))!
  }
  const text = followUpText(type, owner, (await one(`SELECT title FROM tasks WHERE id = $1`, [parentId]))?.title || task.title, today, due, action.content)
  const follow = (await one(
    `INSERT INTO tasks (title, notes, priority, due_date, scheduled_for, status, kind, parent_id, follow_up, last_touched_at)
     VALUES ($1, $2, $3, $4, $4, 'scheduled', 'follow_up', $5, $6::jsonb, now()) RETURNING *`,
    [text.title.slice(0, 500), text.notes, task.priority, due, parentId,
      json({ type, owner, action_id: action.id, handover: action.content, recipient: type === 'email' ? d.to || null : null, subject: d.subject || null, items: [item] })],
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
    await releaseTaskQuestions(r.id)
    await q(`UPDATE tasks SET status = 'queued', stale_nudged_at = $2 WHERE id = $1`, [r.id, now.toISOString()])
  }
  return rows.length
}
