/**
 * Projects, and items Tom wants to come back to.
 *
 * - A project holds tasks (tasks.project_id), a note of what done looks like, and the next step. It comes back for review
 *   on review_on: a fortnight after it is made or last reviewed, unless Tom sets a date.
 * - An item is something to come back to that is not work yet: an idea, an opportunity, an article, a client to call one day.
 *   It comes back on the date Tom chose. Then he makes it a task, pushes it back, or drops it.
 * - What is due back shows on Today and in the morning push.
 */
import { iso, one, q, type Row } from '../db'
import { addDays, londonToday } from '../dates'

export const PROJECT_REVIEW_DAYS = 14

export const projectOut = (p: Row, counts?: { open: number; done: number }) => ({
  id: p.id, kind: p.kind as 'project' | 'item', title: p.title, notes: p.notes, outcome: p.outcome, next_step: p.next_step, link: p.link,
  status: p.status as 'active' | 'someday' | 'done' | 'dropped', review_on: p.review_on, reviewed_at: iso(p.reviewed_at),
  created_at: iso(p.created_at), updated_at: iso(p.updated_at),
  ...(counts ? { open_tasks: counts.open, done_tasks: counts.done } : {}),
})

/** Keep something to come back to. With no date it comes back in a month. */
export async function saveForLater(o: { title: string; notes?: string; link?: string; review_on?: string | null; kind?: 'item' | 'project' }) {
  const kind = o.kind ?? 'item'
  const review = o.review_on || addDays(londonToday(), kind === 'project' ? PROJECT_REVIEW_DAYS : 30)
  return (await one(`INSERT INTO projects (kind, title, notes, link, review_on) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [kind, o.title.trim().slice(0, 300), (o.notes || '').slice(0, 10_000), (o.link || '').slice(0, 1000), review]))!
}

/** Projects and items due back on or before the day, oldest first. */
export async function dueBack(day: string = londonToday()) {
  return q(`SELECT * FROM projects WHERE status IN ('active', 'someday') AND review_on IS NOT NULL AND review_on <= $1 ORDER BY review_on, created_at`, [day])
}

/** Task counts per project, for the list and the progress line. */
export async function taskCounts(ids: string[]) {
  const rows = ids.length ? await q(`SELECT project_id, count(*) FILTER (WHERE status <> 'done')::int AS open, count(*) FILTER (WHERE status = 'done')::int AS done
    FROM tasks WHERE project_id = ANY($1::uuid[]) GROUP BY project_id`, [ids]) : []
  return new Map(rows.map((r) => [String(r.project_id), { open: r.open, done: r.done }]))
}
