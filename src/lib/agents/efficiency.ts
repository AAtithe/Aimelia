/**
 * The efficiency agent: Tom should be asked each thing once.
 *
 * - At the door: when an agent wants to ask Tom something, the question is first checked against every answer Tom has
 *   given on any task, the files he gave with them, what Aimelia knows, and the questions already waiting on other
 *   tasks. One he has already answered is answered for him (marked as answered by Aimelia, with where it came from)
 *   and the task carries on; one already waiting elsewhere is joined to it, so one answer settles both. Only what is
 *   genuinely new reaches him.
 * - Every agent also sees the answers Tom gave on other tasks that bear on its task, so it asks less in the first place.
 * - Daily (06:30 London by default, before the morning push): a full sweep of the waiting questions (merge, reword,
 *   answer from what is known) and a look back over the last two months for questions that keep coming back. Each of
 *   those is offered to Tom as a standing answer: one click keeps it in What Aimelia knows, and it is never asked again.
 * - Everything it does is visible and reversible: Questions shows what it answered for Tom, with Right and Not right,
 *   ask me; Not right reopens the question and holds the task until he answers.
 */
import { json, one, q, type Row } from '../db'
import { canJudge, completeJson } from '../llm'
import { londonParts } from '../dates'
import { memoryForContext } from '../memory/store'
import { logEvent, type Pipeline } from './orchestrator'
import { tidyQuestions, words, type Asked } from './questions'

const clip = (t: unknown, n: number) => { const s = String(t ?? '').trim(); return s.length <= n ? s : `${s.slice(0, n)} ...` }

/** Most auto-answers on one task before everything goes to Tom: a guard against a loop of ask, answer, ask. */
const MAX_AUTO_PER_TASK = 6

/** Answers Tom gave on other tasks (and what his files showed) that share the most words with the text. */
export async function earlierAnswers(text: string, notTaskId: string | null, limit = 12, minShared = 2) {
  const want = words(text)
  if (!want.size) return []
  const rows = await q(`SELECT qn.id, qn.question, qn.answer, qn.answered_by, qn.answered_at, t.title, t.id AS task_id,
      (SELECT string_agg(f.reading->>'answer', ' ') FROM task_files f WHERE f.question_id = qn.id AND f.status = 'ready') AS shown
    FROM questions qn JOIN tasks t ON t.id = qn.task_id
    WHERE qn.status = 'answered' AND qn.answer IS NOT NULL AND ($1::uuid IS NULL OR qn.task_id <> $1)
      AND qn.answered_at > now() - interval '365 days'
    ORDER BY qn.answered_at DESC LIMIT 400`, [notTaskId])
  return rows
    .map((r) => {
      const have = words(`${r.question} ${r.answer} ${r.shown || ''} ${r.title}`)
      let n = 0
      for (const w of want) if (have.has(w)) n++
      return { r, n }
    })
    .filter((x) => x.n >= minShared)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map(({ r }) => ({ id: r.id, task: r.title, question: r.question, answer: clip(r.answer, 800), ...(r.shown ? { files_showed: clip(r.shown, 800) } : {}),
      answered: String(r.answered_at instanceof Date ? r.answered_at.toISOString() : r.answered_at).slice(0, 10), by: r.answered_by === 'aimelia' ? 'aimelia' : 'tom' }))
}

export const SCREEN_PROMPT = `You are the efficiency agent for Tom Stanley, CEO of Williams, Stanley & Co (UK accountants and tax advisers for hospitality
businesses). An agent on his team wants to ask him the questions below. Tom hates being asked the same thing twice. Before
anything reaches him, check each question against: the answers he has already given on other tasks (and what the files he
gave showed), what Aimelia already knows, and the questions already waiting for him on other tasks.

For each question decide one of:
- "answered": Tom's earlier answers or what Aimelia knows give the whole answer for THIS task. Give the answer in full, copying
  names, figures and dates exactly, and say where it came from. Only when nothing about this task could change the answer:
  "what is the deadline" or "how much" for a different job is not answered by another task's answer.
- "same_as_open": a question already waiting for Tom asks the same thing, so one answer from him would settle both. Give its id.
- "ask": it is genuinely new, or you are not sure. When in doubt, ask.

Respond with a single JSON object and nothing else:
{"questions": [{"index": 0, "verdict": "answered|same_as_open|ask", "answer": "", "from": "", "open_id": ""}]}
UK English. No em dashes.`

type Screened = { ask: Asked[]; answered: (Asked & { answer: string; from: string })[]; merged: (Asked & { into: string })[] }

/** Check what an agent wants to ask against everything Tom has already said, before it reaches him. */
export async function screenQuestions(task: Row, asked: Asked[]): Promise<Screened> {
  const out: Screened = { ask: [...asked], answered: [], merged: [] }
  if (!asked.length || !canJudge()) return out
  const auto = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM questions WHERE task_id = $1 AND answered_by = 'aimelia'`, [task.id]))!.n
  if (auto >= MAX_AUTO_PER_TASK) return out
  const text = `${task.title} ${asked.map((a) => a.question).join(' ')}`
  const [earlier, waiting, known] = await Promise.all([
    earlierAnswers(text, task.id),
    q(`SELECT qn.id, qn.question, t.title FROM questions qn JOIN tasks t ON t.id = qn.task_id
       WHERE qn.status = 'open' AND qn.task_id <> $1 AND t.status <> 'done' ORDER BY qn.created_at DESC LIMIT 40`, [task.id]),
    memoryForContext(text, 15),
  ])
  if (!earlier.length && !waiting.length && !known.length) return out
  let reply: any
  try {
    reply = await completeJson({
      provider: 'auto', role: 'screen', system: SCREEN_PROMPT, maxTokens: 2000, timeoutMs: 60_000,
      payload: {
        task: { title: task.title, notes: clip(task.notes, 800) },
        questions_the_agent_wants_to_ask: asked.map((a, index) => ({ index, question: a.question, why: a.why })),
        tom_already_answered: earlier,
        what_aimelia_knows: known,
        already_waiting_for_tom: waiting.map((w) => ({ id: w.id, question: w.question, task: w.title })),
      },
    })
  } catch (e) {
    console.error('Screening questions failed; asking Tom as usual', (e as Error).message)
    return out
  }
  const openIds = new Set(waiting.map((w) => String(w.id)))
  const decided = new Map<number, any>()
  for (const d of Array.isArray(reply?.questions) ? reply.questions : []) {
    const i = Number(d?.index)
    if (Number.isInteger(i) && i >= 0 && i < asked.length && !decided.has(i)) decided.set(i, d)
  }
  out.ask = []
  asked.forEach((a, i) => {
    const d = decided.get(i)
    if (d?.verdict === 'answered' && String(d.answer || '').trim()) out.answered.push({ ...a, answer: clip(d.answer, 2000), from: clip(d.from, 300) })
    else if (d?.verdict === 'same_as_open' && openIds.has(String(d.open_id))) out.merged.push({ ...a, into: String(d.open_id) })
    else out.ask.push(a)
  })
  return out
}

/** Save what the screen settled: answered for Tom, or joined to a question already waiting. */
export async function recordScreened(taskId: string, askedBy: string, s: Screened) {
  for (const a of s.answered) {
    await q(`INSERT INTO questions (task_id, asked_by, question, why, answer, status, answered_at, answered_by)
      VALUES ($1, $2, $3, $4, $5, 'answered', now(), 'aimelia')`, [taskId, askedBy, a.question, a.why, a.answer])
    await logEvent(taskId, 'answer', 'aimelia', { question: a.question, answer: a.answer, source: a.from || 'what you told Aimelia before', screened: true })
  }
  for (const m of s.merged) {
    await q(`INSERT INTO questions (task_id, asked_by, question, why, status, merged_into) VALUES ($1, $2, $3, $4, 'merged', $5)`, [taskId, askedBy, m.question, m.why, m.into])
    const lead = await one(`SELECT t.title FROM questions qn JOIN tasks t ON t.id = qn.task_id WHERE qn.id = $1`, [m.into])
    await logEvent(taskId, 'question_update', 'aimelia', { text: `"${m.question}" is already waiting for you on "${lead?.title || 'another task'}": one answer settles both.` })
  }
}

// ---------------------------------------------------------------- the daily run

export const RECURRING_PROMPT = `You are the efficiency agent for Tom Stanley, CEO of Williams, Stanley & Co. Below are the questions his agent team asked
him over the last two months, with his answers where he gave one, and what Aimelia already keeps as standing knowledge.

Find the questions that keep coming back: the same thing asked on two or more tasks. For each, write the standing answer
that would stop it being asked again, built only from Tom's own answers (copy names, figures and dates exactly; if his
answers disagree, use the latest and say so). Leave out anything already covered by the standing knowledge, anything that
is only true for one job, and anything he has not answered.

Respond with a single JSON object and nothing else:
{"recurring": [{"topic": "short label", "standing_answer": "the answer, as a fact Aimelia can keep", "question_ids": ["..."], "times": 3}]}
An empty list is a good answer. UK English. No em dashes.`

/** Questions that keep coming back, each with a standing answer drawn from Tom's own answers. */
export async function findRecurring() {
  const asked = await q(`SELECT qn.id, qn.question, qn.answer, qn.answered_by, t.title FROM questions qn JOIN tasks t ON t.id = qn.task_id
    WHERE qn.created_at > now() - interval '60 days' AND qn.status IN ('answered', 'open', 'merged') ORDER BY qn.created_at DESC LIMIT 200`)
  if (asked.length < 3 || !canJudge()) return []
  const standing = await q(`SELECT subject, content FROM memories WHERE status = 'active' ORDER BY pinned DESC, updated_at DESC LIMIT 80`)
  const reply = await completeJson({
    provider: 'auto', role: 'recurring', system: RECURRING_PROMPT, maxTokens: 3000, timeoutMs: 90_000,
    payload: {
      questions: asked.map((r) => ({ id: r.id, task: r.title, question: r.question, tom_answered: r.answered_by === 'aimelia' ? null : r.answer })),
      standing_knowledge: standing.map((m) => `${m.subject}: ${m.content}`),
    },
  })
  const ids = new Set(asked.map((r) => String(r.id)))
  return (Array.isArray(reply?.recurring) ? reply.recurring : [])
    .map((r: any) => ({ topic: clip(r?.topic, 120), standing_answer: clip(r?.standing_answer, 1000),
      question_ids: (Array.isArray(r?.question_ids) ? r.question_ids : []).map(String).filter((id: string) => ids.has(id)),
      times: Math.max(2, Number(r?.times) || 0) }))
    .filter((r: any) => r.topic && r.standing_answer && r.question_ids.length >= 2)
    .slice(0, 10)
}

/** Whether today's run is due: switched on, past its time in London, and not run today. */
export async function efficiencyDue(p: Pipeline, now: Date = new Date()) {
  if (p.efficiency_enabled === false) return false
  const t = londonParts(now)
  if (t.time < (p.efficiency_time || '06:30')) return false
  return !(await one(`SELECT id FROM efficiency_runs WHERE day = $1 AND trigger = 'daily'`, [t.date]))
}

/** The daily sweep (or a run Tom asks for). Claimed first, so two ticks never run it twice. */
export async function runEfficiency(trigger: 'daily' | 'manual', now: Date = new Date()) {
  const day = londonParts(now).date
  const run = trigger === 'daily'
    ? await one(`INSERT INTO efficiency_runs (day, trigger) VALUES ($1, 'daily') ON CONFLICT (day) WHERE trigger = 'daily' DO NOTHING RETURNING *`, [day])
    : await one(`INSERT INTO efficiency_runs (day, trigger) VALUES ($1, 'manual') RETURNING *`, [day])
  if (!run) return null
  const report: Record<string, unknown> = {}
  try {
    report.tidy = await tidyQuestions({ force: true })
    report.recurring = await findRecurring()
  } catch (e) {
    report.error = (e as Error).message
  }
  const day24 = await one<{ answered: number; merged: number }>(`SELECT
      count(*) FILTER (WHERE answered_by = 'aimelia' AND answered_at > now() - interval '24 hours')::int AS answered,
      count(*) FILTER (WHERE status = 'merged' AND COALESCE(updated_at, created_at) > now() - interval '24 hours')::int AS merged
    FROM questions`)
  report.last_24_hours = day24
  await q(`UPDATE efficiency_runs SET report = $2::jsonb, finished_at = now() WHERE id = $1`, [run.id, json(report)])
  return { id: run.id, day, trigger, report }
}

export async function lastEfficiencyRun() {
  return one(`SELECT * FROM efficiency_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`)
}
