/**
 * Ask Aimelia: a chat agent Tom can talk to about his work.
 *
 * Each turn the model sees the conversation and a fixed list of tools, and answers with one JSON
 * object: either tool calls to make, or the reply for Tom. Tools run here, their results go back
 * to the model, and the loop repeats up to MAX_STEPS times. The protocol is plain JSON rather than
 * a provider's native tool use, so it works the same with Claude, OpenAI and the mock.
 *
 * Tom can attach photos, PDFs and documents to a message (see files.ts). Photos and PDFs go to the model
 * as they are, for the last few messages only; documents go as their text.
 *
 * Every tool reads, except create_task, answer_question and add_to_knowledge, which do exactly what the
 * matching buttons do. Nothing is ever sent: email stays as drafts made elsewhere, and the calendar is only read.
 */
import { iso, one, q } from '../db'
import { complete, parseJson, type Attachment, type Message } from '../llm'
import { londonParts } from '../dates'
import { runLater } from '../router'
import { index, search } from '../email/knowledge'
import { upcomingEvents } from '../email/briefs'
import { connection } from '../microsoft'
import { resumeIfAnswered } from '../agents/api'
import { getPipeline, logEvent, processQueue, seedDefaults } from '../agents/orchestrator'
import { touch } from '../agents/schedule'
import { CATALOGUE, compact, configuredSources, lookup } from '../agents/sources'

export const MAX_STEPS = 6
const MAX_CALLS = 4
const HISTORY = 20
const FILES_IN_VIEW = 6 // photos and PDFs are sent again only for this many most recent messages
const MAX_DOC_TEXT = 30_000
const MAX_RESULT = 6000
const clip = (t: unknown, n = 400) => { const s = String(t ?? ''); return s.length <= n ? s : `${s.slice(0, n)} ...` }

export type Turn = { role: string; content: string; files?: { name: string; kind: string; media_type: string; data: string | null; text: string | null }[] }
export type Step = { tool: string; args: Record<string, unknown>; ok: boolean; note: string }
type Args = Record<string, any>
type Tool = { about: string; args: string; available?: () => Promise<boolean> | boolean; run: (a: Args) => Promise<unknown> }

const TASK_COLS = `id, title, status, priority, due_date, summary, source`
const taskLine = (t: any) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, summary: clip(t.summary, 300), source: t.source ?? null })

export const TOOLS: Record<string, Tool> = {
  briefing: {
    about: 'What is waiting on Tom now: task counts by status, open questions from the agents, drafts ready to approve, follow-ups due',
    args: '{}',
    run: async () => {
      const [counts, questions, actions, due] = await Promise.all([
        q(`SELECT status, count(*)::int AS n FROM tasks GROUP BY status`),
        q(`SELECT qn.id, qn.question, qn.asked_by, t.title AS task FROM questions qn JOIN tasks t ON t.id = qn.task_id
           WHERE qn.status = 'open' AND t.status = 'needs_input' ORDER BY t.priority, qn.created_at LIMIT 10`),
        q(`SELECT a.title, a.kind, t.title AS task, t.id AS task_id FROM actions a JOIN tasks t ON t.id = a.task_id
           WHERE a.status = 'proposed' AND t.status = 'ready' ORDER BY t.priority, t.created_at, a.position LIMIT 10`),
        q(`SELECT ${TASK_COLS} FROM tasks WHERE status = 'due' ORDER BY due_date LIMIT 10`),
      ])
      return { counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), open_questions: questions, drafts_to_approve: actions, follow_ups_due: due.map(taskLine) }
    },
  },
  search_tasks: {
    about: 'Find tasks by words in the title or notes, and/or by status (queued, processing, needs_input, ready, done, failed, scheduled, due)',
    args: '{"query": "optional words", "status": "optional status", "include_done": false}',
    run: async (a) => {
      const words = String(a.query || '').trim()
      const rows = await q(`SELECT ${TASK_COLS} FROM tasks
        WHERE ($1 = '' OR title ILIKE '%' || $1 || '%' OR notes ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR status = $2) AND ($3 OR $2 = 'done' OR status <> 'done')
        ORDER BY priority, created_at DESC LIMIT 15`, [words, a.status ? String(a.status) : null, !!a.include_done])
      return { found: rows.length, tasks: rows.map(taskLine) }
    },
  },
  get_task: {
    about: 'One task in full: notes, the agents\' draft actions and their questions',
    args: '{"id": "task id from search_tasks or briefing"}',
    run: async (a) => {
      const t = await one(`SELECT * FROM tasks WHERE id::text = $1`, [String(a.id || '')])
      if (!t) return 'No task with that id.'
      const [questions, actions] = await Promise.all([
        q(`SELECT id, question, why, answer, status, asked_by FROM questions WHERE task_id = $1 ORDER BY created_at`, [t.id]),
        q(`SELECT kind, title, content, status FROM actions WHERE task_id = $1 AND status <> 'superseded' ORDER BY position`, [t.id]),
      ])
      return { ...taskLine(t), notes: clip(t.notes, 1500), questions, actions: actions.map((x) => ({ ...x, content: clip(x.content, 1200) })) }
    },
  },
  create_task: {
    about: 'Add a task for the agent team to work, exactly as Add task does. Only when Tom asks for something to be added, captured, chased or delegated',
    args: '{"title": "short imperative title", "notes": "every detail Tom gave", "priority": 1|2|3 (1 high), "due_date": "YYYY-MM-DD or null"}',
    run: async (a) => {
      const title = String(a.title || '').trim().slice(0, 500)
      if (!title) return 'Not created: a task needs a title.'
      const priority = [1, 2, 3].includes(Number(a.priority)) ? Number(a.priority) : 2
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(a.due_date || '')) ? String(a.due_date) : null
      await seedDefaults()
      const t = (await one(`INSERT INTO tasks (title, notes, priority, due_date, source, last_touched_at) VALUES ($1, $2, $3, $4, 'chat', now()) RETURNING id, title, status, due_date`,
        [title, String(a.notes || ''), priority, due]))!
      runLater(() => processQueue({ limit: 5 }))
      return { created: true, id: t.id, title: t.title, status: t.status, due_date: t.due_date }
    },
  },
  answer_question: {
    about: 'Answer an open question the agents asked on a task, when Tom gives the answer in the chat. The task then goes back to the agents',
    args: '{"question_id": "id from briefing or get_task", "answer": "Tom\'s answer in his words"}',
    run: async (a) => {
      const answer = String(a.answer || '').trim()
      const qn = await one(`SELECT * FROM questions WHERE id::text = $1`, [String(a.question_id || '')])
      if (!qn) return 'No question with that id.'
      if (qn.status !== 'open') return 'That question has already been dealt with.'
      if (!answer) return 'Not answered: the answer is empty.'
      await q(`UPDATE questions SET answer = $2, status = 'answered', answered_at = now() WHERE id = $1`, [qn.id, answer])
      await touch(qn.task_id)
      await logEvent(qn.task_id, 'answer', 'tom', { question: qn.question, answer, via: 'chat' })
      const resumed = await resumeIfAnswered(qn.task_id, 'questions answered')
      return { answered: true, task_back_with_agents: resumed }
    },
  },
  search_knowledge: {
    about: 'Search the knowledge base: sorted emails, meeting briefs, and documents and policies Tom has added',
    args: '{"query": "words to search for"}',
    run: async (a) => {
      const rows = await search(String(a.query || ''), 5)
      return rows.map((r) => ({ title: r.title, source: r.source, text: clip(r.chunk, 900) }))
    },
  },
  add_to_knowledge: {
    about: 'Save text to the knowledge base so every feature can draw on it, as Add a document does. Only when Tom asks to file, save or keep something. For a photo or PDF, write out the text you read',
    args: '{"title": "short title", "text": "the full text to keep", "kind": "document|policy|manual"}',
    run: async (a) => {
      const title = String(a.title || '').trim().slice(0, 300)
      const text = String(a.text || '').trim()
      if (!title || !text) return 'Not saved: it needs a title and the text.'
      const kind = ['document', 'policy', 'manual'].includes(a.kind) ? String(a.kind) : 'document'
      const parts = await index(kind, `${kind}-${Date.now()}`, title, text)
      return { saved: true, title, kind, parts }
    },
  },
  recent_emails: {
    about: 'Tom\'s recent inbox as sorted by email triage: sender, subject, category, urgency 1-5, the action needed',
    args: '{"urgent_only": false, "limit": 10}',
    run: async (a) => {
      const limit = Math.min(Math.max(Number(a.limit) || 10, 1), 25)
      const rows = await q(`SELECT subject, from_name, from_email, received_at, category, urgency, action_required, summary, draft_link IS NOT NULL AS drafted
        FROM emails WHERE ($1 = false OR urgency >= 4) ORDER BY received_at DESC NULLS LAST LIMIT $2`, [!!a.urgent_only, limit])
      if (!rows.length) return 'No sorted email stored yet. Email triage fills this once Microsoft 365 is connected.'
      return rows.map((r) => ({ ...r, received_at: iso(r.received_at), summary: clip(r.summary, 300) }))
    },
  },
  upcoming_meetings: {
    about: 'Tom\'s calendar for the next N hours (read only), with whether a brief is ready',
    args: '{"hours": 24}',
    available: async () => (await connection().catch(() => ({ connected: false }))).connected,
    run: async (a) => {
      const hours = Math.min(Math.max(Number(a.hours) || 24, 1), 24 * 14)
      const events = (await upcomingEvents(hours, 25)).filter((e) => !e.isAllDay)
      const briefed = new Set((await q(`SELECT graph_event_id FROM meetings WHERE brief IS NOT NULL AND graph_event_id = ANY($1::text[])`, [events.map((e) => e.id)])).map((r) => r.graph_event_id))
      return events.map((e) => ({ subject: e.subject, start: e.start?.dateTime, end: e.end?.dateTime, location: e.location?.displayName || '',
        online: !!e.isOnlineMeeting, attendees: (e.attendees || []).map((x) => x.emailAddress?.name || x.emailAddress?.address).filter(Boolean).slice(0, 12), brief_ready: briefed.has(e.id) }))
    },
  },
  ws_lookup: {
    about: 'Read-only facts from the firm\'s systems. Only the catalogue entries listed under ws_systems can be used',
    args: '{"source": "wscip|pcc", "tool": "catalogue entry name", "params": {}}',
    available: () => Object.values(configuredSources()).some(Boolean),
    run: async (a) => {
      if (!(configuredSources() as Record<string, boolean>)[String(a.source)]) return `${a.source} is not connected.`
      return lookup(String(a.source), String(a.tool), a.params && typeof a.params === 'object' ? a.params : {})
    },
  },
}

/** The tools that can run right now (the calendar needs Microsoft 365, lookups need WSCIP or PCC). */
export async function availableTools(): Promise<string[]> {
  const out: string[] = []
  for (const [name, t] of Object.entries(TOOLS)) if (!t.available || (await t.available())) out.push(name)
  return out
}

function systemPrompt(houseRules: string, tools: string[]) {
  const now = londonParts()
  const live = Object.entries(configuredSources()).filter(([, ok]) => ok).map(([s]) => s as keyof typeof CATALOGUE)
  const catalogue = tools.includes('ws_lookup') ? Object.fromEntries(live.map((s) => [s, {
    system: CATALOGUE[s].label,
    tools: Object.fromEntries(Object.entries(CATALOGUE[s].tools).map(([n, [, p, d]]) => [n, { answers: d, params: p }])),
  }])) : null
  return `You are Aimelia, Tom Stanley's assistant at Williams, Stanley & Co, talking with Tom in a chat.
It is ${now.date} ${now.time}, London.

${houseRules}

You can use these tools:
${JSON.stringify(Object.fromEntries(tools.map((n) => [n, { does: TOOLS[n].about, args: TOOLS[n].args }])), null, 1)}
${catalogue ? `\nws_systems (for ws_lookup):\n${JSON.stringify(catalogue, null, 1)}\n` : ''}
Respond with a single JSON object and nothing else, one of:
{"tool_calls": [ {"tool": "name", "args": {}} ]}   to look things up or act, up to ${MAX_CALLS} at once
{"reply": "your answer to Tom"}                   when you have what you need

How to work:
- Use the tools for any fact about Tom's tasks, email, diary, knowledge base or clients. Never guess or invent one.
- If a tool says something is unavailable or not connected, say so plainly rather than working around it.
- create_task, answer_question and add_to_knowledge change things: use them only when Tom asks, then confirm what you did.
- Tom may attach photos, PDFs or documents: receipts, invoices, letters from HMRC, whiteboards, screenshots, management accounts.
  Read them yourself. Say what matters in them, quote figures exactly, and say plainly if something is unreadable.
  Offer to turn the actions in them into tasks, or to file them in the knowledge base.
- You cannot send email or change the calendar. Offer to add a task instead, and the agent team drafts it for approval.
- Replies are plain text: short paragraphs or simple lists, no markdown headings, no bold, no tables.
- Lead with the answer. Be brief. Flag anything touching money movement, HMRC, VAT, PAYE, NIC or tronc.`
}

/**
 * The conversation as the model sees it. Documents become text inside the message; photos and PDFs are
 * attached only for the last FILES_IN_VIEW messages, and named as no longer in view before that.
 * Consecutive messages from the same side are merged, so a turn that failed half way never breaks the next.
 */
function history(rows: Turn[]): Message[] {
  const out: Message[] = []
  const recent = rows.slice(-HISTORY)
  recent.forEach((r, i) => {
    const role = r.role === 'assistant' ? 'assistant' : 'user'
    const inView = i >= recent.length - FILES_IN_VIEW
    const files: Attachment[] = []
    let content = r.content.trim() || (r.files?.length ? '(No message, just the attached files. Read them and say what matters.)' : '')
    for (const f of r.files || []) {
      if (f.kind === 'text') content += `\n\n[Attached document: ${f.name}]\n${clip(f.text, MAX_DOC_TEXT)}`
      else if (inView && f.data) files.push({ kind: f.kind === 'pdf' ? 'pdf' : 'image', media_type: f.media_type, data: f.data, name: f.name })
      else content += `\n\n[Tom attached ${f.name} earlier; it is no longer in view. Ask him to send it again if you need it.]`
    }
    if (files.length) content += `\n\n[Attached: ${files.map((f) => f.name).join(', ')}]`
    if (!content.trim()) content = '(No message, just the attached files.)'
    const last = out.at(-1)
    if (last && last.role === role) {
      last.content += `\n\n${content}`
      if (files.length) last.files = [...(last.files || []), ...files]
    } else out.push({ role, content: content.trim(), ...(files.length ? { files } : {}) })
  })
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

function asResult(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(compact(value))
  return text.length <= MAX_RESULT ? text : `${text.slice(0, MAX_RESULT)} ... (trimmed)`
}

/** Run one turn: the conversation so far (ending with Tom's message) in, the reply and the steps taken out. */
export async function converse(rows: Turn[]): Promise<{ reply: string; steps: Step[] }> {
  const pipeline = await getPipeline()
  const tools = await availableTools()
  const system = systemPrompt(pipeline.house_rules, tools)
  const messages = history(rows)
  const steps: Step[] = []

  for (let step = 0; step < MAX_STEPS; step++) {
    const last = step === MAX_STEPS - 1
    const text = await complete({ provider: 'auto', role: 'chat', system, messages, maxTokens: 2000, temperature: 0.3, json: true,
      payload: { message: rows.at(-1)?.content, files: (rows.at(-1)?.files || []).map((f) => f.name), step, steps, tools } })
    let out: any
    try { out = parseJson(text) } catch { return { reply: text.trim(), steps } } // plain text is taken as the reply
    const calls = Array.isArray(out.tool_calls) ? out.tool_calls.slice(0, MAX_CALLS) : []
    if (!calls.length || last) {
      const reply = typeof out.reply === 'string' && out.reply.trim() ? out.reply.trim()
        : last && calls.length ? 'I ran out of steps before finishing. Ask again with a narrower question.' : 'I have nothing to add.'
      return { reply, steps }
    }
    const results = []
    for (const c of calls) {
      const name = String(c?.tool || '')
      const args: Args = c?.args && typeof c.args === 'object' ? c.args : {}
      if (!tools.includes(name)) {
        steps.push({ tool: name, args, ok: false, note: 'not available' })
        results.push({ tool: name, result: `Unknown or unavailable tool. Use one of: ${tools.join(', ')}` })
        continue
      }
      try {
        const value = await TOOLS[name].run(args)
        steps.push({ tool: name, args, ok: true, note: typeof value === 'string' ? clip(value, 120) : '' })
        results.push({ tool: name, result: asResult(value) })
      } catch (e) {
        const msg = clip((e as Error).message, 300)
        steps.push({ tool: name, args, ok: false, note: msg })
        results.push({ tool: name, result: `unavailable: ${msg}` })
      }
    }
    messages.push({ role: 'assistant', content: JSON.stringify({ tool_calls: calls }) })
    messages.push({ role: 'user', content: `Tool results:\n${JSON.stringify(results)}${step === MAX_STEPS - 2 ? '\n\nThat was your last lookup: reply to Tom now.' : ''}` })
  }
  return { reply: 'I ran out of steps before finishing.', steps } // not reached
}
