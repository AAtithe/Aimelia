/**
 * Every question Aimelia puts to Tom comes with answers he can pick with one click.
 *
 * - The agents, the question tidy and the memory checks are asked for two to four likely answers with each question.
 * - When a model leaves them out, one short call suggests them before the question is saved.
 * - Questions saved before options existed (options IS NULL) are given them on the next tick, once.
 * Free text stays available on every question: an option is a shortcut, never the only way to answer.
 */
import { q } from '../db'
import { canJudge, completeJson } from '../llm'

export const MAX_OPTIONS = 4

/** The rule every prompt that asks Tom something carries. */
export const OPTIONS_RULE = `Every question comes with "options": two to four short, distinct answers Tom could give, most likely first, each one he could pick as his whole answer (a name, a date, a figure, "Yes, ..." / "No, ..."). Do not add "Other" or "Not sure": he can always write his own.`

/** Tidy what a model gave: unique, non-empty, short, at most four. Fewer than two is no choice at all. */
export function cleanOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const o of raw) {
    const text = String(typeof o === 'object' && o ? (o as any).label ?? (o as any).text ?? '' : o ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!text || /^(other|not sure|none of (the|these) above)\.?$/i.test(text)) continue
    if (out.some((x) => x.toLowerCase() === text.toLowerCase())) continue
    out.push(text)
    if (out.length === MAX_OPTIONS) break
  }
  return out.length >= 2 ? out : []
}

export const OPTIONS_PROMPT = `You help Tom Stanley, CEO of Williams, Stanley & Co (UK accountants and tax advisers for hospitality businesses), answer questions from his assistant Aimelia quickly. For each question below, give two to four short, distinct answers he is most likely to give, most likely first, so he can answer with one click. Each one must work as his whole answer: a name, a date, a figure, a choice, or "Yes, ..." / "No, ...". Use the task and the reason for the question to make them specific. Do not add "Other" or "Not sure": he can always write his own. UK English. No em dashes.

Return JSON only:
{"questions": [{"index": 0, "options": ["...", "..."]}]}`

type Asking = { question: string; why?: string; options?: string[]; context?: string }

/** Options for the questions that have none, in one call. Returns the list in the same order; [] where none came back. */
export async function suggestOptions(asked: Asking[]): Promise<string[][]> {
  const out = asked.map((a) => cleanOptions(a.options))
  const missing = out.map((o, i) => (o.length ? -1 : i)).filter((i) => i >= 0)
  if (!missing.length || !canJudge()) return out
  try {
    const reply = await completeJson({
      provider: 'auto', role: 'question_options', system: OPTIONS_PROMPT, maxTokens: 1500, timeoutMs: 45_000,
      payload: { questions: missing.map((i) => ({ index: i, question: asked[i].question, why: asked[i].why || '', about: (asked[i].context || '').slice(0, 500) })) },
    })
    for (const r of Array.isArray(reply?.questions) ? reply.questions : []) {
      const i = Number(r?.index)
      if (missing.includes(i)) out[i] = cleanOptions(r?.options)
    }
  } catch (e) {
    console.error('Suggesting answers failed; the question is asked without them', (e as Error).message)
  }
  return out
}

/** Open questions saved before options existed get them now. Each is tried once: [] means none could be given. */
export async function fillMissingOptions(limit = 20) {
  if (!canJudge()) return 0
  const tasks = await q(`SELECT qn.id, qn.question, qn.why, t.title FROM questions qn JOIN tasks t ON t.id = qn.task_id
    WHERE qn.status = 'open' AND qn.options IS NULL ORDER BY qn.created_at LIMIT $1`, [limit])
  const memory = await q(`SELECT id, question, why FROM memory_questions WHERE status = 'open' AND options IS NULL ORDER BY created_at LIMIT $1`, [limit])
  if (!tasks.length && !memory.length) return 0
  const all = [...tasks.map((r) => ({ table: 'questions', id: r.id, question: r.question, why: r.why, context: `Task: ${r.title}` })),
    ...memory.map((r) => ({ table: 'memory_questions', id: r.id, question: r.question, why: r.why, context: 'What Aimelia remembers' }))]
  const got = await suggestOptions(all)
  let filled = 0
  for (const [i, r] of all.entries()) {
    await q(`UPDATE ${r.table} SET options = $2::jsonb WHERE id = $1 AND options IS NULL`, [r.id, JSON.stringify(got[i])])
    if (got[i].length) filled++
  }
  return filled
}
