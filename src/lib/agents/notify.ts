/**
 * Morning push: what needs Tom today, to Teams and/or his phone. Never email.
 * TEAMS_WEBHOOK_URL: a Teams Workflows "When a Teams webhook request is received" URL.
 * NTFY_URL: an ntfy topic URL for phone push (NTFY_TOKEN if the topic is protected).
 */
import { env } from '../env'
import { q } from '../db'
import { londonParts, londonToday } from '../dates'
import type { Pipeline } from './orchestrator'
import { urgencySql } from './urgency'
import { briefingStages } from './stages'

export const channels = () => ({ teams: !!env.teamsWebhook(), phone: !!env.ntfyUrl() })

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export async function buildBrief() {
  const urgent = await q(`SELECT title, urgent_reason FROM tasks WHERE urgent AND status <> 'done' ORDER BY urgent_at`)
  const questions = await q(`SELECT qn.question, t.title FROM questions qn JOIN tasks t ON t.id = qn.task_id
                             WHERE qn.status = 'open' AND t.status = 'needs_input' ORDER BY ${urgencySql()} DESC, qn.created_at`)
  const actions = await q(`SELECT a.title FROM actions a JOIN tasks t ON t.id = a.task_id
                           WHERE a.status = 'proposed' AND t.status = 'ready' ORDER BY t.priority, a.position`)
  const followUps = await q(`SELECT title FROM tasks WHERE status = 'due' ORDER BY due_date`)
  const stages = (await briefingStages(`${urgencySql()} DESC`)).filter((s) => s.kind === 'ask')
  const toDo = await q(`SELECT a.title FROM actions a JOIN tasks t ON t.id = a.task_id WHERE a.status = 'approved' AND t.status <> 'done' ORDER BY t.priority, a.approved_at`)
  const overdue = (await q(`SELECT count(*)::int AS n FROM tasks WHERE status NOT IN ('done','scheduled') AND due_date < $1`, [londonToday()]))[0].n as number
  const planned = await q(`SELECT title FROM tasks WHERE planned_for = $1 AND status <> 'done' ORDER BY priority, created_at`, [londonToday()])
  const back = await q(`SELECT title, kind FROM projects WHERE status IN ('active', 'someday') AND review_on <= $1 ORDER BY review_on`, [londonToday()])
  const saved = (await q(`SELECT count(*)::int AS n FROM questions WHERE answered_by = 'aimelia' AND reviewed_at IS NULL AND answered_at > now() - interval '24 hours'`))[0].n as number
  const parts: string[] = []
  if (urgent.length) parts.push(`${urgent.length} urgent and vital`)
  if (questions.length) parts.push(`${plural(questions.length, 'question')} to answer`)
  if (actions.length) parts.push(`${actions.length} ready to approve`)
  if (stages.length) parts.push(`${plural(stages.length, 'person', 'people')} to ask`)
  if (toDo.length) parts.push(`${toDo.length} approved to do`)
  if (followUps.length) parts.push(`${plural(followUps.length, 'follow-up')} due`)
  if (overdue) parts.push(overdue === 1 ? '1 past its due date' : `${overdue} past their due date`)
  if (planned.length) parts.push(`${plural(planned.length, 'task')} planned for today`)
  if (back.length) parts.push(`${back.length} back on your desk`)
  const lines = [
    ...(saved ? [`Aimelia answered ${saved === 1 ? 'a question' : `${saved} questions`} for you from what you said before: check them in Questions.`] : []),
    ...urgent.slice(0, 3).map((x) => `Urgent: ${x.title}${x.urgent_reason ? ` (${x.urgent_reason})` : ''}`),
    ...questions.slice(0, 3).map((x) => `Answer: ${x.question} (${x.title})`),
    ...stages.slice(0, 3).map((x) => `Ask ${x.who}: ${x.title} (${x.task_title})`),
    ...followUps.slice(0, 3).map((x) => `Follow up: ${x.title}`),
    ...actions.slice(0, 4).map((x) => `Approve: ${x.title}`),
    ...toDo.slice(0, 3).map((x) => `Do: ${x.title}`),
    ...planned.slice(0, 4).map((x) => `Today: ${x.title}`),
    ...back.slice(0, 3).map((x) => `Back to look at: ${x.title}${x.kind === 'project' ? ' (project review)' : ''}`),
  ]
  return { headline: parts.length ? parts.join(', ') : 'Nothing needs you this morning', lines, empty: !parts.length,
    counts: { urgent: urgent.length, questions: questions.length, actions: actions.length, to_do: toDo.length, follow_ups: followUps.length, to_ask: stages.length, overdue, planned: planned.length, back: back.length } }
}

type Brief = Awaited<ReturnType<typeof buildBrief>>

export function teamsPayload(brief: Brief) {
  const card = {
    type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
    body: [
      { type: 'TextBlock', text: (brief as { title?: string }).title || 'Aimelia: this morning', weight: 'Bolder', size: 'Medium', color: 'Accent' },
      { type: 'TextBlock', text: brief.headline, wrap: true },
      ...brief.lines.map((line) => ({ type: 'TextBlock', text: `- ${line}`, wrap: true, spacing: 'Small' })),
    ],
    actions: [{ type: 'Action.OpenUrl', title: 'Open Aimelia', url: `${env.appUrl()}/tasks` }],
  }
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }] }
}

export async function send(brief: Brief): Promise<Record<string, string>> {
  const results: Record<string, string> = {}
  const teams = env.teamsWebhook()
  if (teams) {
    try {
      const r = await fetch(teams, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(teamsPayload(brief)) })
      results.teams = r.ok ? 'sent' : `failed: HTTP ${r.status}`
    } catch (e) { results.teams = `failed: ${(e as Error).message}` }
  }
  const ntfy = env.ntfyUrl()
  if (ntfy) {
    const headers: Record<string, string> = { Title: 'Aimelia', Click: `${env.appUrl()}/tasks`, Tags: 'clipboard' }
    if (env.ntfyToken()) headers.Authorization = `Bearer ${env.ntfyToken()}`
    try {
      const r = await fetch(ntfy, { method: 'POST', headers, body: [brief.headline, ...brief.lines].join('\n') })
      results.phone = r.ok ? 'sent' : `failed: HTTP ${r.status}`
    } catch (e) { results.phone = `failed: ${(e as Error).message}` }
  }
  if (!Object.keys(results).length) results.none = 'No channel is set up. Set TEAMS_WEBHOOK_URL or NTFY_URL in Vercel.'
  return results
}

export function dueNow(p: Pick<Pipeline, 'brief_enabled' | 'brief_time' | 'brief_weekends' | 'last_brief_date'>, now: Date = new Date()): boolean {
  if (!p.brief_enabled) return false
  const { date, time, weekday } = londonParts(now)
  if (weekday >= 5 && !p.brief_weekends) return false
  if (p.last_brief_date === date) return false
  return time >= (p.brief_time || '07:30')
}

export async function maybeSendMorning(p: Pipeline, now: Date = new Date()) {
  if (!dueNow(p, now)) return null
  // Claim today's send first so overlapping ticks never send twice.
  const claimed = await q(`UPDATE pipeline SET last_brief_date = $1 WHERE id = 1 AND last_brief_date IS DISTINCT FROM $1 RETURNING id`, [londonParts(now).date])
  if (!claimed.length) return null
  return send(await buildBrief())
}
