/**
 * Email, calendar and briefing API, mounted at /api/mail. Same access rules as everything else.
 */
import { z } from 'zod'
import { one, q } from '../db'
import { body, fail } from '../http'
import { complete } from '../llm'
import type { Endpoint } from '../router'
import { env } from '../env'
import { addressOf, emailOut, getMessage, runTriage, summariseThread, summaryOf } from './mail'
import { triageEmail, urgencyLevel } from './triage'
import { createDraft, createReplyDraft, generateReply, GUIDELINES } from './drafting'
import { briefForEvent, meetingOut, prepareUpcoming, PREP_GUIDELINES, testBrief, upcomingEvents } from './briefs'
import { index, search } from './knowledge'
import { buildMessages } from './context'
import { JOBS, jobsStatus, runJob, type JobId } from './jobs'
import { analytics } from './analytics'
import { PERSONA } from './persona'

const SmartReply = z.object({ email_id: z.string().min(1), thread_summary: z.string().default('') })
const TestDraft = z.object({ subject: z.string().default('Test Email'), sender: z.string().default('client@example.com'),
  body: z.string().default('This is a test email body.'), thread_summary: z.string().default('') })
const NewDraft = z.object({ to: z.string().min(3), subject: z.string().min(1), body: z.string().min(1) })
const TestBrief = z.object({ subject: z.string().trim().min(1), start_time: z.string().optional(), attendees: z.array(z.string()).default([]),
  location: z.string().default(''), style: z.enum(['brief', 'prep']).default('prep') })
const Doc = z.object({ title: z.string().trim().min(1).max(300), text: z.string().trim().min(1).max(200000), source: z.enum(['document', 'policy', 'manual']).default('document') })
const JobPatch = z.object({ enabled: z.boolean().optional(), auto_draft: z.boolean().optional() })
const Generate = z.object({ task: z.enum(['triage', 'reply', 'brief', 'digest', 'analysis', 'default']).default('default'),
  meta: z.record(z.string(), z.any()).default({}), query: z.string().default('') })
const TriageTry = z.object({ subject: z.string().default(''), sender: z.string().default(''), body: z.string().default('') })

async function listEmails(req: Request) {
  const u = new URL(req.url)
  const filter = u.searchParams.get('filter') || 'all'
  const where = filter === 'urgent' ? 'WHERE urgency >= 4' : filter === 'ai' ? `WHERE method = 'ai'` : filter === 'rules' ? `WHERE method = 'rules'` : ''
  const rows = await q(`SELECT * FROM emails ${where} ORDER BY received_at DESC NULLS LAST LIMIT 100`)
  return { status: 'ok', message_count: rows.length, triaged_emails: rows.map(emailOut), summary: summaryOf(rows) }
}

export const mailEndpoints: Endpoint[] = [
  // ---------------------------------------------------------------- email triage
  ['GET', '/emails', listEmails],
  ['POST', '/triage/run', async (req) => { const r = await runTriage(25); return { ...(await listEmails(req)), fetched: r.fetched, newly_triaged: r.triaged } }],
  ['POST', '/emails/:id/analyze', async (_r, p) => {
    const m = await getMessage(p.id)
    const t = await triageEmail(m.subject || '', addressOf(m), m.body?.content || m.bodyPreview || '')
    const thread = m.conversationId ? await summariseThread(m.conversationId) : { message_count: 1, summary: '' }
    const reply = await generateReply({ subject: m.subject || '', sender: addressOf(m), sender_name: m.from?.emailAddress?.name, thread_summary: thread.summary, original_body: m.body?.content || '' })
    await q(`UPDATE emails SET category=$2, urgency=$3, confidence=$4, method=$5, reasoning=$6, action_required=$7, summary=$8, suggested_reply=$9 WHERE graph_id=$1`,
      [p.id, t.category, t.urgency, t.confidence, t.method, t.reasoning, t.action_required ?? null, thread.summary, reply.text])
    return { status: 'ok', email: { id: m.id, subject: m.subject, from: addressOf(m), received: m.receivedDateTime, body_preview: m.bodyPreview },
      analysis: { triage: t, summary: thread.summary, thread_messages: thread.message_count, suggested_response: reply.text, sensitive_topics: reply.sensitive_topics, urgency_level: urgencyLevel(t.urgency) } }
  }],
  ['POST', '/emails/:id/summary', async (_r, p) => {
    const m = await getMessage(p.id)
    if (!m.conversationId) fail(404, 'That message has no thread.')
    const s = await summariseThread(m.conversationId!)
    await q(`UPDATE emails SET summary = $2 WHERE graph_id = $1`, [p.id, s.summary])
    return { status: 'ok', thread_id: m.conversationId, ...s }
  }],
  ['POST', '/drafts', async (req) => { const b = await body(req, NewDraft); return { success: true, ...(await createDraft(b.to, b.subject, b.body)) } }],

  // ---------------------------------------------------------------- smart drafting
  ['POST', '/draft/smart-reply', async (req) => {
    const b = await body(req, SmartReply)
    const m = await getMessage(b.email_id)
    const reply = await generateReply({ subject: m.subject || '', sender: addressOf(m), sender_name: m.from?.emailAddress?.name, thread_summary: b.thread_summary, original_body: m.body?.content || '' })
    const d = await createReplyDraft(m.id, reply.text)
    await q(`UPDATE emails SET draft_id = $2, draft_link = $3, suggested_reply = $4 WHERE graph_id = $1`, [m.id, d.id, d.link, reply.text])
    return { success: true, draft_id: d.id, draft_link: d.link, subject: d.subject || `Re: ${m.subject}`, draft_content: reply.text, preview: `${reply.text.slice(0, 100)}...`,
      word_count: reply.word_count, meets_requirements: reply.meets_requirements, sensitive_topics: reply.sensitive_topics,
      message: 'Reply draft created in Outlook, in the same thread. Nothing was sent.' }
  }],
  ['POST', '/draft/auto-process', async (req) => {
    const { email_id } = await body(req, z.object({ email_id: z.string().min(1) }))
    const m = await getMessage(email_id)
    const thread = m.conversationId ? await summariseThread(m.conversationId) : { summary: `Email from ${addressOf(m)} regarding ${m.subject}` }
    const reply = await generateReply({ subject: m.subject || '', sender: addressOf(m), sender_name: m.from?.emailAddress?.name, thread_summary: thread.summary, original_body: m.body?.content || '' })
    const d = await createReplyDraft(m.id, reply.text)
    await q(`UPDATE emails SET draft_id = $2, draft_link = $3, suggested_reply = $4, summary = COALESCE(summary, $5) WHERE graph_id = $1`, [m.id, d.id, d.link, reply.text, thread.summary])
    return { success: true, email_id, subject: m.subject, sender: addressOf(m), draft_created: true, draft_id: d.id, draft_link: d.link, draft_content: reply.text,
      word_count: reply.word_count, sensitive_topics: reply.sensitive_topics, message: 'Read the thread and drafted a reply in Outlook. Nothing was sent.' }
  }],
  ['POST', '/draft/test', async (req) => {
    const b = await body(req, TestDraft)
    const r = await generateReply({ subject: b.subject, sender: b.sender, thread_summary: b.thread_summary, original_body: b.body })
    return { success: true, draft_content: r.text, word_count: r.word_count, sensitive_topics: r.sensitive_topics, meets_requirements: r.meets_requirements }
  }],
  ['GET', '/draft/guidelines', async () => GUIDELINES],

  // ---------------------------------------------------------------- calendar and briefs
  ['GET', '/calendar/next24', async () => ({ timezone: env.timezone(), value: await upcomingEvents(24, 20) })],
  ['GET', '/briefs/upcoming', async () => {
    const events = await upcomingEvents(24 * 7, 25)
    const stored = await q(`SELECT * FROM meetings WHERE graph_event_id = ANY($1::text[])`, [events.map((e) => e.id)])
    const byId = new Map(stored.map((m) => [m.graph_event_id, m]))
    return { status: 'ok', briefs: events.map((e) => ({ event: e, ...(byId.has(e.id) ? meetingOut(byId.get(e.id)!) : { brief: null }) })) }
  }],
  ['POST', '/briefs/:id', async (req, p) => {
    const style = new URL(req.url).searchParams.get('style') === 'brief' ? 'brief' : 'prep'
    return briefForEvent(p.id, style)
  }],
  ['POST', '/prep/next24h', async (req) => prepareUpcoming('prep', new URL(req.url).searchParams.get('force') === 'true')],
  ['POST', '/prep/test', async (req) => { const b = await body(req, TestBrief); return testBrief(b, b.style) }],
  ['GET', '/prep/guidelines', async () => PREP_GUIDELINES],

  // ---------------------------------------------------------------- knowledge
  ['GET', '/knowledge', async (req) => {
    const u = new URL(req.url)
    const query = u.searchParams.get('q') || ''
    if (query) return { results: await search(query, Math.min(Number(u.searchParams.get('top_k')) || 8, 25)) }
    const rows = await q(`SELECT id, source, source_id, title, left(chunk, 300) AS chunk, created_at FROM kb_chunks ORDER BY created_at DESC LIMIT 100`)
    const counts = await q(`SELECT source, count(*)::int AS n FROM kb_chunks GROUP BY source`)
    return { results: rows, counts: Object.fromEntries(counts.map((c) => [c.source, c.n])) }
  }],
  ['POST', '/knowledge', async (req) => {
    const b = await body(req, Doc)
    const id = `${b.source}-${Date.now()}`
    return Response.json({ stored_chunks: await index(b.source, id, b.title, b.text), source_id: id }, { status: 201 })
  }],
  ['DELETE', '/knowledge/:id', async (_r, p) => { const r = await q(`DELETE FROM kb_chunks WHERE id = $1 RETURNING id`, [p.id]); if (!r.length) fail(404, 'Not found.') }],

  // ---------------------------------------------------------------- AI workbench
  ['POST', '/ai/triage', async (req) => { const b = await body(req, TriageTry); return { triage: await triageEmail(b.subject, b.sender, b.body) } }],
  ['POST', '/ai/generate', async (req) => {
    const b = await body(req, Generate)
    const built = await buildMessages(b.task, b.meta, b.query)
    const text = await complete({ provider: 'auto', role: 'generate', system: built.system, messages: built.messages, maxTokens: 900, temperature: 0.3, payload: b })
    return { task: b.task, content: text.trim(), context_used: { examples: (built.messages.length - 1) / 2, knowledge: built.messages.at(-1)!.content.includes('Relevant background') } }
  }],
  ['GET', '/ai/persona', async () => ({ persona: PERSONA })],

  // ---------------------------------------------------------------- automation
  ['GET', '/jobs', async () => ({ jobs: await jobsStatus(), logs: await q(`SELECT job, level, message, created_at FROM job_logs ORDER BY id DESC LIMIT 50`) })],
  ['PATCH', '/jobs/:id', async (req, p) => {
    if (!(p.id in JOBS)) fail(404, 'No such job.')
    const b = await body(req, JobPatch)
    await jobsStatus()
    if (b.enabled !== undefined) await q(`UPDATE jobs SET enabled = $2 WHERE id = $1`, [p.id, b.enabled])
    if (b.auto_draft !== undefined) await q(`UPDATE jobs SET options = options || jsonb_build_object('auto_draft', $2::boolean) WHERE id = $1`, [p.id, b.auto_draft])
    return (await jobsStatus()).find((j) => j.id === p.id)
  }],
  ['POST', '/jobs/:id/run', async (_r, p) => { if (!(p.id in JOBS)) fail(404, 'No such job.'); return { job: p.id, result: await runJob(p.id as JobId) } }],

  // ---------------------------------------------------------------- analytics
  ['GET', '/analytics', async (req) => analytics(Number(new URL(req.url).searchParams.get('days')) || 30)],
]


