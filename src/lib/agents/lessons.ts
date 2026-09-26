/**
 * Learning from Tom's corrections. Every edit, send-back and piece of feedback is stored as a
 * lesson; the most recent active lessons go to every agent on every task.
 */
import { q } from '../db'
import { londonToday } from '../dates'

const CLIP = 700
const clip = (t: string) => (!t ? '' : t.length <= CLIP ? t : `${t.slice(0, CLIP)} ...`)

export async function recordLesson(source: 'edit' | 'rejection' | 'feedback', l: { taskTitle?: string; actionKind?: string | null; before?: string; after?: string; note?: string }) {
  await q(`INSERT INTO lessons (source, action_kind, task_title, before, after, note) VALUES ($1, $2, $3, $4, $5, $6)`,
    [source, l.actionKind ?? null, l.taskTitle || '', l.before || '', l.after || '', l.note || ''])
}

export async function lessonsForContext(limit: number) {
  if (!limit) return []
  const rows = await q(`SELECT * FROM lessons WHERE active ORDER BY created_at DESC LIMIT $1`, [limit])
  return rows.map((r) => ({
    from: r.source, on: r.task_title, kind: r.action_kind,
    ...(r.note ? { tom_said: clip(r.note) } : {}),
    ...(r.source === 'edit' ? { agents_wrote: clip(r.before), tom_changed_it_to: clip(r.after) } : {}),
  }))
}

/** Per month: delivered, approved as they stood, edited, sent back. Falling edits mean the team is learning. */
export async function learningStats(months = 3) {
  const today = londonToday()
  const [y, m] = today.split('-').map(Number)
  const buckets = Array.from({ length: months }, (_, i) => {
    const index = m - 1 - (months - 1 - i)
    const yy = y + Math.floor(index / 12)
    const mm = (((index % 12) + 12) % 12) + 1
    return { month: `${yy}-${String(mm).padStart(2, '0')}`, delivered: 0, approved_as_is: 0, edited: 0, sent_back: 0 }
  })
  const rows = await q(`SELECT to_char(created_at AT TIME ZONE 'Europe/London', 'YYYY-MM') AS month, status, edited
                        FROM actions WHERE status <> 'superseded' AND created_at > now() - interval '120 days'`)
  for (const r of rows) {
    const b = buckets.find((x) => x.month === r.month)
    if (!b) continue
    b.delivered++
    if (r.status === 'rejected') b.sent_back++
    else if (r.edited) b.edited++
    else if (r.status === 'approved' || r.status === 'done') b.approved_as_is++
  }
  return buckets
}
