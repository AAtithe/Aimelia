/**
 * Urgent and vital: the fast lane. A task marked urgent goes to the top of every list, is the agents' next task,
 * and Tom is told at once on Teams or his phone. Tom marks it (or types "urgent" or "asap" when adding it); the AI
 * that tidies what he adds and the agents working it can mark it too, with the reason. Tom's call is final: an agent
 * never overrides a task Tom has marked or cleared.
 */
import { one } from '../db'
import { env } from '../env'
import { runLater } from '../router'
import { logEvent } from './orchestrator'
import { send } from './notify'

export async function markUrgent(taskId: string, urgent: boolean, reason: string | null, by: string): Promise<boolean> {
  const t = await one(`SELECT id, title, urgent, urgent_by, urgent_reason, status FROM tasks WHERE id = $1`, [taskId])
  if (!t) return false
  if (by !== 'tom' && t.urgent_by === 'tom') return false
  const why = (reason || '').trim().slice(0, 300) || null
  if (t.urgent === urgent && (!urgent || (why || null) === (t.urgent_reason || null)) && t.urgent_by === by) return false
  if (by !== 'tom' && (!urgent || t.urgent)) return false // only Tom clears it; the first to mark it keeps it
  await one(`UPDATE tasks SET urgent = $2, urgent_reason = $3, urgent_by = $4, urgent_at = now(), updated_at = now() WHERE id = $1 RETURNING id`,
    [taskId, urgent, urgent ? why : null, by])
  await logEvent(taskId, 'status', by, { status: t.status, reason: urgent ? `marked urgent and vital${why ? `: ${why}` : ''}` : 'no longer urgent' })
  if (urgent && !t.urgent && t.status !== 'done') runLater(() => alertUrgent(t.title, why, by))
  return true
}

/** Tell Tom straight away, on whichever channels are set up. Nothing is sent when none is. */
export async function alertUrgent(title: string, reason: string | null, by: string) {
  if (!env.teamsWebhook() && !env.ntfyUrl()) return
  const who = by === 'tom' ? 'You marked it' : by === 'aimelia' ? 'Aimelia marked it when you added it' : `${by} marked it`
  await send({ title: 'Aimelia: urgent and vital', headline: `Urgent: ${title}`, lines: [reason || 'No reason given.', `${who}. It is at the top of Today.`],
    empty: false, counts: {} } as any)
}
