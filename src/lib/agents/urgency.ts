/**
 * How urgent a task is, as one score, so the most urgent work is always at the top.
 *
 * Higher is more urgent. Urgent and vital outranks everything; then being past due (more the longer it is), due
 * today, due in the next few days; then priority; then waiting on Tom (his answer or approval frees the team), and a
 * little for age so nothing sinks for ever. The same formula runs in SQL (to sort lists and pick the agents' next
 * task) and here (to say why a task is where it is).
 */
import { addDays, londonToday, type Ymd } from '../dates'

export const WAITING_ON_TOM = ['needs_input', 'ready', 'doing', 'waiting', 'due', 'failed']

/** The score as a SQL expression over tasks aliased t. today is a checked YYYY-MM-DD, so it is safe to inline. */
export function urgencySql(today: Ymd = londonToday()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('bad date')
  const d = (n: number) => `'${addDays(today, n)}'`
  return `(CASE WHEN t.urgent THEN 1000 ELSE 0 END
    + CASE WHEN t.due_date IS NULL OR t.status = 'done' THEN 0
           WHEN t.due_date < ${d(0)} THEN 400 + LEAST(200, 10 * (DATE ${d(0)} - t.due_date::date))
           WHEN t.due_date = ${d(0)} THEN 350
           WHEN t.due_date <= ${d(2)} THEN 250
           WHEN t.due_date <= ${d(7)} THEN 120
           WHEN t.due_date <= ${d(14)} THEN 50 ELSE 0 END
    + CASE t.priority WHEN 1 THEN 300 WHEN 2 THEN 150 ELSE 0 END
    + CASE WHEN t.status IN ('${WAITING_ON_TOM.join("','")}') THEN 30 ELSE 0 END
    + LEAST(60, 2 * FLOOR(EXTRACT(EPOCH FROM (now() - t.created_at)) / 86400)))`
}

const days = (a: Ymd, b: Ymd) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)

type T = { urgent?: boolean | null; urgent_reason?: string | null; due_date?: string | null; priority: number; status: string; created_at?: string | Date | null }

/** The same score, and the plain reason a task sits where it does. */
export function urgencyOf(t: T, today: Ymd = londonToday(), now = Date.now()) {
  let score = t.urgent ? 1000 : 0
  let reason = t.urgent ? `Urgent and vital${t.urgent_reason ? `: ${t.urgent_reason}` : ''}` : ''
  if (t.due_date && t.status !== 'done') {
    const late = days(today, t.due_date)
    let due = ''
    if (late > 0) { score += 400 + Math.min(200, 10 * late); due = `Overdue by ${late} day${late === 1 ? '' : 's'}` }
    else if (late === 0) { score += 350; due = 'Due today' }
    else if (late >= -2) { score += 250; due = late === -1 ? 'Due tomorrow' : `Due in ${-late} days` }
    else if (late >= -7) { score += 120; due = `Due in ${-late} days` }
    else if (late >= -14) score += 50
    if (due && !reason) reason = due
    else if (due) reason = `${reason}. ${due}`
  }
  score += t.priority === 1 ? 300 : t.priority === 2 ? 150 : 0
  if (!reason && t.priority === 1) reason = 'High priority'
  if (WAITING_ON_TOM.includes(t.status)) score += 30
  const created = t.created_at ? new Date(t.created_at).getTime() : now
  score += Math.min(60, 2 * Math.floor((now - created) / 86400000))
  return { score, reason: reason || null }
}

/** Words in what Tom types that mark a task urgent straight away. */
export const URGENT_WORDS = /(^|\s)(urgent(ly)?|asap|!!+|immediately|right away|top priority)(?=\s|[.,:;!]|$)/i

export const URGENT_GUIDE = `Urgent and vital means it must be dealt with in the next day or two and real harm follows if it is not: a legal,
HMRC, Companies House or regulatory deadline, payroll or a supplier payment at risk, cash or banking problems, a key client
or relationship at risk, a staff or safety matter. Busy, important or a client chasing is not enough.`
