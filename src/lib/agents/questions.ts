/**
 * The questions the agents are waiting on Tom for, kept as one tidy list.
 *
 * - When an agent asks, a question that repeats one already on the task (open, answered or
 *   declined), in the same or near-identical words, is dropped.
 * - One question can stand for several tasks. The kept one stays open; the others become
 *   merged into it and still hold their tasks. Answering either answers all of them, and
 *   every task it held goes back to the team.
 * - tidyQuestions runs on every tick when the list has changed since the last run. The AI
 *   reads every open question with the answers Tom has already given and what Aimelia knows,
 *   then merges questions one answer would settle (across tasks too), rewords any that newer
 *   answers have made out of date, and answers any Tom has in fact already answered. An
 *   answer it is less than sure of is offered as a suggestion instead.
 */
import { one, q, type Row } from '../db'
import { canJudge, completeJson } from '../llm'
import { memoryForContext } from '../memory/store'
import { logEvent } from './orchestrator'

export type Asked = { question: string; why: string }
export const BLOCKING = `('open','merged')`

const STOP = new Set(('a an and are as at be by can could do does for from has have how i if in is it its of on or please ' +
  'should so that the their them there this to was we what when where which who whom will with would you your ' +
  'now just also currently still exactly').split(' '))
export function words(s: string) {
  return new Set(s.toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '').replace(/[^a-z0-9£%.\s]/g, ' ').split(/\s+/).map((w) => w.replace(/\.$/, '')).filter((w) => w && !STOP.has(w)))
}
/** Share of content words two questions have in common (Jaccard). 1 is the same question. */
export function similarity(a: string, b: string) {
  const x = words(a), y = words(b)
  if (!x.size && !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both / (x.size + y.size - both)
}
export const SAME = 0.75

/** Save what an agent asked, skipping repeats of anything already asked on this task. Returns how many were added. */
export async function recordQuestions(taskId: string, askedBy: string, asked: Asked[]) {
  const known = (await q(`SELECT question FROM questions WHERE task_id = $1`, [taskId])).map((r) => r.question as string)
  let added = 0
  for (const qn of asked) {
    if (known.some((k) => similarity(k, qn.question) >= SAME)) continue
    await q(`INSERT INTO questions (task_id, asked_by, question, why) VALUES ($1, $2, $3, $4)`, [taskId, askedBy, qn.question, qn.why])
    known.push(qn.question)
    added++
  }
  return added
}

/** A task held only by questions that are now settled goes back to the team. Returns the ids that went. */
export async function resumeTasks(taskIds: string[], reason: string, actor = 'aimelia') {
  const resumed: string[] = []
  for (const id of [...new Set(taskIds)]) {
    const r = await one(`UPDATE tasks SET status = 'queued', updated_at = now() WHERE id = $1 AND status = 'needs_input'
      AND NOT EXISTS (SELECT 1 FROM questions WHERE task_id = $1 AND status IN ${BLOCKING}) RETURNING id`, [id])
    if (r) { await logEvent(id, 'status', actor, { status: 'queued', reason }); resumed.push(id) }
  }
  return resumed
}

/** The question itself and every question merged into it. */
async function family(id: string) {
  const qn = await one(`SELECT * FROM questions WHERE id = $1`, [id])
  if (!qn) return null
  const head = qn.status === 'merged' && qn.merged_into ? (await one(`SELECT * FROM questions WHERE id = $1`, [qn.merged_into])) || qn : qn
  const members = await q(`SELECT * FROM questions WHERE id = $1 OR (merged_into = $1 AND status = 'merged')`, [head.id])
  return { asked: qn, head, members }
}

/**
 * Answer a question and everything merged with it. by is 'tom' or 'aimelia' (answered from
 * something Tom already said). Returns null when there is no such question, or the question
 * and the tasks it put back with the team.
 */
export async function answerQuestion(id: string, answer: string, opts: { by?: string; via?: string; source?: string } = {}) {
  const f = await family(id)
  if (!f) return null
  const by = opts.by || 'tom'
  const open = f.members.filter((m) => m.status === 'open' || m.status === 'merged')
  for (const m of open) {
    await q(`UPDATE questions SET answer = $2, status = 'answered', answered_at = now(), answered_by = $3, suggested_answer = NULL, merged_into = NULL WHERE id = $1`, [m.id, answer, by])
    await logEvent(m.task_id, 'answer', by, { question: f.head.question, answer, ...(opts.via ? { via: opts.via } : {}), ...(opts.source ? { source: opts.source } : {}),
      ...(open.length > 1 ? { shared_with: open.length - 1 } : {}) })
  }
  const question = await one(`SELECT * FROM questions WHERE id = $1`, [f.asked.id])
  return { question: question!, head: f.head, tasks: [...new Set(open.map((m) => m.task_id as string))] }
}

/** Tom skipped the question: the team uses its judgement on every task it held. */
export async function dismissQuestion(id: string) {
  const f = await family(id)
  if (!f) return null
  const open = f.members.filter((m) => m.status === 'open' || m.status === 'merged')
  for (const m of open) await q(`UPDATE questions SET status = 'dismissed', merged_into = NULL, suggested_answer = NULL WHERE id = $1`, [m.id])
  const question = await one(`SELECT * FROM questions WHERE id = $1`, [f.asked.id])
  return { question: question!, tasks: [...new Set(open.map((m) => m.task_id as string))] }
}

/** Put a merged question's group under a new lead: the oldest of them becomes the open one. */
async function promote(fromId: string) {
  const kids = await q(`SELECT id FROM questions WHERE merged_into = $1 AND status = 'merged' ORDER BY created_at`, [fromId])
  if (!kids.length) return
  const lead = kids[0].id
  const head = await one(`SELECT question, why FROM questions WHERE id = $1`, [fromId])
  await q(`UPDATE questions SET status = 'open', merged_into = NULL, question = COALESCE($2, question), why = COALESCE($3, why), updated_at = now() WHERE id = $1`,
    [lead, head?.question ?? null, head?.why ?? null])
  await q(`UPDATE questions SET merged_into = $2 WHERE merged_into = $1 AND status = 'merged'`, [fromId, lead])
}

/** A task is going back through Triage without Tom's answers: clear its questions, and hand any it led to the next task in the group. */
export async function releaseTaskQuestions(taskId: string) {
  for (const r of await q(`SELECT id FROM questions WHERE task_id = $1 AND status = 'open'`, [taskId])) await promote(r.id)
  await q(`UPDATE questions SET status = 'dismissed', merged_into = NULL WHERE task_id = $1 AND status IN ${BLOCKING}`, [taskId])
}

/** Repairs that need no AI: groups left without a lead, and repeats on one task. */
async function repair() {
  let fixed = 0
  // A merged question whose lead is gone (task deleted), settled, or on a closed task.
  const loose = await q(`SELECT c.id, c.merged_into, h.id AS head_id, h.status AS head_status, h.answer AS head_answer, ht.status AS head_task
    FROM questions c LEFT JOIN questions h ON h.id = c.merged_into LEFT JOIN tasks ht ON ht.id = h.task_id
    WHERE c.status = 'merged' AND (h.id IS NULL OR h.status <> 'open' OR ht.status = 'done')`)
  const promoted = new Set<string>()
  for (const r of loose) {
    if (r.head_id && r.head_status === 'answered') { await answerQuestion(r.id, r.head_answer, { by: 'aimelia', source: 'the question it was merged with' }); fixed++ }
    else if (r.head_id && r.head_status === 'open') { if (!promoted.has(r.head_id)) { await promote(r.head_id); promoted.add(r.head_id); fixed++ } }
    else if (r.head_id && r.head_status === 'dismissed') { await q(`UPDATE questions SET status = 'dismissed', merged_into = NULL WHERE id = $1`, [r.id]); fixed++ }
    else { await q(`UPDATE questions SET status = 'open', merged_into = NULL, updated_at = now() WHERE id = $1`, [r.id]); fixed++ }
  }
  // Two open questions on one task asking the same thing.
  const open = await q(`SELECT id, task_id, question FROM questions WHERE status = 'open' ORDER BY created_at`)
  const byTask = new Map<string, Row[]>()
  for (const r of open) byTask.set(r.task_id, [...(byTask.get(r.task_id) || []), r])
  for (const rows of byTask.values()) {
    const kept: Row[] = []
    for (const r of rows) {
      const lead = kept.find((k) => similarity(k.question, r.question) >= SAME)
      if (!lead) { kept.push(r); continue }
      await q(`UPDATE questions SET status = 'merged', merged_into = $2 WHERE id = $1`, [r.id, lead.id])
      await q(`UPDATE questions SET merged_into = $2 WHERE merged_into = $1 AND status = 'merged'`, [r.id, lead.id])
      fixed++
    }
  }
  return fixed
}

export const TIDY_PROMPT = `You keep the list of questions an agent team is waiting on Tom Stanley for. Tom is the CEO of Williams, Stanley & Co., a London accountancy firm for hospitality businesses. Too many questions, or the same question asked twice, wastes his time.

You get every open question (with its task), the answers Tom has already given on other questions, and what Aimelia already knows.

Return JSON only:
{
  "merge": [{"keep": "id", "merge": ["id", ...], "question": "one question that covers them all", "why": "why it matters"}],
  "answered": [{"id": "id", "answer": "the answer, in full", "from": "which earlier answer or fact it comes from", "confidence": "high" | "medium"}],
  "reword": [{"id": "id", "question": "the question as it should now read", "why": "why it matters"}]
}

Rules:
- merge only questions that one answer from Tom would settle, on the same task or across tasks. "What is the deadline?" on two different tasks is two questions; "Who is the FD at Corrigans?" asked on two Corrigans tasks is one. When the tasks differ, the merged question names what it covers so it reads right on its own.
- answered: only when Tom's earlier answers or what Aimelia knows already give the whole answer for this task. Copy the facts; never guess. high means nothing about this task could change the answer. Otherwise medium.
- reword: only when newer answers have made a question out of date or half answered; ask only what is still missing. Keep it short and specific.
- Leave anything else alone: an empty list is the usual answer. Never invent questions. Use the ids exactly as given; each id appears at most once across all three lists.
- UK English. No em dashes.`

/** What the AI sees; the signature changes whenever a question is added, settled or changed. */
async function snapshot() {
  const open = await q(`SELECT qn.id, qn.question, qn.why, qn.asked_by, qn.created_at, qn.updated_at, t.id AS task_id, t.title, t.notes
    FROM questions qn JOIN tasks t ON t.id = qn.task_id
    WHERE qn.status = 'open' AND t.status <> 'done' ORDER BY qn.created_at LIMIT 60`)
  const settled = await one(`SELECT count(*)::int AS n, max(answered_at)::text AS last FROM questions WHERE status IN ('answered','dismissed')`)
  const signature = [open.map((r) => `${r.id}:${r.updated_at ? new Date(r.updated_at).getTime() : ''}`).join(','), settled?.n, settled?.last].join('|')
  return { open, signature }
}

/**
 * The recurring tidy. Cheap repairs every time; the AI pass only when the list has changed
 * since the last run, there are at least two questions or one plus an earlier answer, and a
 * real model is set up (the placeholder cannot judge meaning).
 */
export async function tidyQuestions(opts: { force?: boolean } = {}) {
  const report = { repaired: await repair(), merged: 0, answered: 0, suggested: 0, reworded: 0, resumed: 0, skipped: '' as string }
  const { open, signature } = await snapshot()
  const last = await one(`SELECT value FROM app_config WHERE key = 'questions_tidy'`)
  if (!opts.force && last?.value === signature) { report.skipped = 'unchanged'; return report }
  const done = async () => { await q(`INSERT INTO app_config (key, value) VALUES ('questions_tidy', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [(await snapshot()).signature]) }
  const answers = await q(`SELECT qn.id, qn.question, qn.answer, t.title FROM questions qn JOIN tasks t ON t.id = qn.task_id
    WHERE qn.status = 'answered' AND qn.answer IS NOT NULL AND qn.answered_at > now() - interval '120 days' ORDER BY qn.answered_at DESC LIMIT 60`)
  if (!open.length || (open.length < 2 && !answers.length)) { report.skipped = 'nothing to compare'; await done(); return report }
  if (!canJudge()) { report.skipped = 'no AI key'; await done(); return report }

  const byId = new Map(open.map((r) => [String(r.id), r]))
  const reply = await completeJson({
    provider: 'auto', role: 'questions', system: TIDY_PROMPT, maxTokens: 4000, timeoutMs: 90_000,
    payload: {
      open_questions: open.map((r) => ({ id: r.id, question: r.question, why: r.why, asked_by: r.asked_by, task: { title: r.title, notes: String(r.notes || '').slice(0, 500) } })),
      tom_already_answered: answers.map((r) => ({ id: r.id, task: r.title, question: r.question, answer: r.answer })),
      what_aimelia_knows: await memoryForContext(open.map((r) => `${r.title} ${r.question}`).join(' '), 20),
    },
  })

  const used = new Set<string>()
  const take = (id: unknown) => { const k = String(id || ''); if (!byId.has(k) || used.has(k)) return null; used.add(k); return byId.get(k)! }

  for (const g of Array.isArray(reply?.merge) ? reply.merge : []) {
    const ids = [g.keep, ...(Array.isArray(g.merge) ? g.merge : [])].map(String)
    if (new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id) || used.has(id)) || ids.length < 2) continue
    const [lead, ...rest] = ids.map((id) => take(id)!)
    const text = String(g.question || '').trim() || lead.question
    await q(`UPDATE questions SET question = $2, why = $3, updated_at = now() WHERE id = $1`, [lead.id, text, String(g.why || lead.why || '')])
    for (const r of rest) {
      await q(`UPDATE questions SET status = 'merged', merged_into = $2, updated_at = now() WHERE id = $1`, [r.id, lead.id])
      await q(`UPDATE questions SET merged_into = $2 WHERE merged_into = $1 AND status = 'merged'`, [r.id, lead.id])
      await logEvent(r.task_id, 'question_update', 'aimelia', { text: `Merged "${r.question}" into one question${r.task_id === lead.task_id ? '' : ` shared with "${lead.title}"`}: ${text}` })
      report.merged++
    }
    if (text !== lead.question) await logEvent(lead.task_id, 'question_update', 'aimelia', { text: `Reworded to cover ${rest.length + 1} questions: ${text}` })
  }

  for (const a of Array.isArray(reply?.answered) ? reply.answered : []) {
    const r = take(a.id)
    const answer = String(a.answer || '').trim()
    if (!r || !answer) continue
    const source = String(a.from || '').trim().slice(0, 300)
    if (a.confidence === 'high') {
      const res = await answerQuestion(r.id, answer, { by: 'aimelia', source })
      if (res) { report.answered++; report.resumed += (await resumeTasks(res.tasks, 'answered from what you told Aimelia before')).length }
    } else {
      await q(`UPDATE questions SET suggested_answer = $2, suggested_from = $3, updated_at = now() WHERE id = $1`, [r.id, answer, source])
      report.suggested++
    }
  }

  for (const w of Array.isArray(reply?.reword) ? reply.reword : []) {
    const r = take(w.id)
    const text = String(w.question || '').trim()
    if (!r || !text || text === r.question) continue
    await q(`UPDATE questions SET question = $2, why = COALESCE(NULLIF($3, ''), why), updated_at = now() WHERE id = $1`, [r.id, text, String(w.why || '')])
    await logEvent(r.task_id, 'question_update', 'aimelia', { text: `Updated the question: was "${r.question}", now "${text}"` })
    report.reworded++
  }

  await done()
  return report
}
