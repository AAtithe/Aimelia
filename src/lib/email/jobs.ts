/**
 * Background email jobs, run from the cron tick (the old APScheduler never started on its own).
 *  - triage: hourly, fetch and triage new mail; optionally draft replies for urgent mail (off by default)
 *  - briefs: 06:00 and 18:00 London, prepare meetings in the next 24 hours
 * The 08:00 digest is the morning push (Agent team settings), which now covers email and meetings too.
 */
import { iso, json, one, q } from '../db'
import { londonParts } from '../dates'
import { accessToken } from '../microsoft'
import { registerTickStep } from '../tick'
import { runTriage, getMessage, addressOf } from './mail'
import { prepareUpcoming } from './briefs'
import { createReplyDraft, generateReply } from './drafting'

export const JOBS = {
  triage: { name: 'Email triage', schedule: 'Every hour', description: 'Reads new mail in your inbox, sorts it by category and urgency, and saves the result.' },
  briefs: { name: 'Meeting briefs', schedule: '06:00 and 18:00', description: 'Prepares a six-section brief for every meeting in the next 24 hours that has none.' },
} as const
export type JobId = keyof typeof JOBS

async function ensureJobs() {
  for (const id of Object.keys(JOBS)) await q(`INSERT INTO jobs (id, enabled, options) VALUES ($1, true, '{}'::jsonb) ON CONFLICT (id) DO NOTHING`, [id])
}

export async function log(job: string, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  await q(`INSERT INTO job_logs (job, level, message) VALUES ($1, $2, $3)`, [job, level, message.slice(0, 1000)])
  await q(`DELETE FROM job_logs WHERE id IN (SELECT id FROM job_logs ORDER BY id DESC OFFSET 500)`)
}

export async function runJob(id: JobId): Promise<unknown> {
  await ensureJobs()
  const job = (await one(`SELECT * FROM jobs WHERE id = $1`, [id]))!
  let result: any
  if (id === 'triage') {
    result = await runTriage(25)
    if (job.options?.auto_draft && result.triaged) {
      // Only urgent, real correspondence gets a draft; never automated mail.
      const urgent = await q(`SELECT graph_id, subject, from_email, from_name FROM emails WHERE graph_id = ANY($1::text[]) AND urgency >= 4
                              AND category NOT IN ('Automated','Spam') AND draft_id IS NULL`, [result.ids])
      let drafted = 0
      for (const e of urgent) {
        const m = await getMessage(e.graph_id)
        const reply = await generateReply({ subject: e.subject, sender: addressOf(m), sender_name: e.from_name, original_body: m.body?.content || '' })
        const d = await createReplyDraft(e.graph_id, reply.text)
        await q(`UPDATE emails SET draft_id = $2, draft_link = $3, suggested_reply = $4 WHERE graph_id = $1`, [e.graph_id, d.id, d.link, reply.text])
        drafted++
      }
      result.drafted = drafted
    }
    delete result.ids
    await log('triage', `Fetched ${result.fetched}, triaged ${result.triaged} new${result.drafted ? `, drafted ${result.drafted} replies` : ''}.`)
  } else {
    result = await prepareUpcoming('prep')
    await log('briefs', result.message, result.errors.length ? 'warn' : 'info')
    result = { total_meetings: result.total_meetings, meetings_prepared: result.meetings_prepared, errors: result.errors }
  }
  await q(`UPDATE jobs SET last_run_at = now(), last_result = $2::jsonb WHERE id = $1`, [id, json(result)])
  return result
}

/** Which slot a job is due in right now, or null. A slot runs once. */
export function dueSlot(id: JobId, now: Date = new Date()): string | null {
  const { date, time } = londonParts(now)
  if (id === 'triage') return `${date}T${time.slice(0, 2)}`
  if (time >= '18:00') return `${date}T18`
  if (time >= '06:00') return `${date}T06`
  return null
}

export async function runDueJobs(now: Date = new Date()) {
  if (!(await accessToken())) return 'Microsoft 365 not connected'
  await ensureJobs()
  const out: Record<string, unknown> = {}
  for (const id of Object.keys(JOBS) as JobId[]) {
    const slot = dueSlot(id, now)
    if (!slot) continue
    const claimed = await q(`UPDATE jobs SET last_slot = $2 WHERE id = $1 AND enabled AND last_slot IS DISTINCT FROM $2 RETURNING id`, [id, slot])
    if (!claimed.length) continue
    try { out[id] = await runJob(id) } catch (e) { out[id] = `failed: ${(e as Error).message}`; await log(id, (e as Error).message, 'error') }
  }
  return out
}

export async function jobsStatus() {
  await ensureJobs()
  const rows = await q(`SELECT * FROM jobs ORDER BY id DESC`)
  return rows.map((r) => ({ id: r.id, ...JOBS[r.id as JobId], enabled: r.enabled, options: r.options || {}, last_run_at: iso(r.last_run_at), last_result: r.last_result }))
}

registerTickStep(['email_jobs', () => runDueJobs()])
