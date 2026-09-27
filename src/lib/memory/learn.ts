/**
 * Learning from Tom's notes, and the weekly check.
 *
 * learnFromNotes: each new note goes to the AI with the memories that may relate to it. The AI adds, updates or
 * confirms memories, or raises a conflict as a question for Tom. A pinned memory (Tom's own) is never changed:
 * an update to one becomes a question. A note that fails is tried again by the background timer, three times.
 *
 * weeklyCheck: every Sunday from 18:00 London (or when Tom asks), the AI reads every active memory with the week's
 * notes, Tom's recent corrections and his open tasks. It merges duplicates, updates what is out of date, archives
 * what is finished, and asks Tom up to five questions. Every change is logged and can be undone from the page.
 */
import { iso, json, one, q, type Row } from '../db'
import { complete, parseJson } from '../llm'
import { addDays, londonParts } from '../dates'
import { MEMORY_PROMPT, MEMORY_REVIEW_PROMPT } from '../agents/defaults'
import { lessonsForContext } from '../agents/lessons'
import { addMemory, askTom, changeMemory, confirmMemory, onNote, relatedMemories, sourceFrom, type Actor } from './store'

const LEARN_TIMEOUT_MS = 90_000
const REVIEW_TIMEOUT_MS = 200_000
const MAX_ATTEMPTS = 3
const MAX_QUESTIONS = 5
const clip = (t: unknown, n: number) => { const s = String(t ?? '').trim(); return s.length <= n ? s : `${s.slice(0, n)} ...` }

async function claimNote(): Promise<Row | null> {
  return one(`UPDATE memory_notes SET claimed_at = now(), attempts = attempts + 1
    WHERE id = (SELECT id FROM memory_notes WHERE processed_at IS NULL AND attempts < $1
                  AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
                ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING *`, [MAX_ATTEMPTS])
}

/** Apply what the AI made of one note. Ids must be among the memories it was shown. */
export async function applyNoteOps(ops: unknown, note: Row, shown: Row[]) {
  const byId = new Map(shown.map((m) => [String(m.id), m]))
  const source = sourceFrom(note)
  const done = { added: 0, updated: 0, confirmed: 0, questions: 0 }
  for (const op of Array.isArray(ops) ? ops.slice(0, 12) : []) {
    if (!op || typeof op !== 'object') continue
    const o = op as Record<string, any>
    if (o.op === 'add' && String(o.content || '').trim()) {
      // Already held word for word: confirm it instead of adding it twice.
      const same = await one(`SELECT id FROM memories WHERE status = 'active' AND lower(content) = lower($1)`, [String(o.content).trim()])
      if (same) { await confirmMemory(same.id, source, 'capture'); done.confirmed++ }
      else if (await addMemory({ kind: o.kind, subject: String(o.subject || ''), content: String(o.content), sources: [source] }, 'capture')) done.added++
    } else if (o.op === 'update' && byId.has(String(o.id))) {
      const m = byId.get(String(o.id))!
      const changed = await changeMemory(m.id, { content: String(o.content || ''), source }, 'capture', String(o.why || ''))
      if (changed) done.updated++
      else if (await askTom(`You told me "${clip(m.content, 200)}". Your note says "${clip(note.text, 200)}". Which is right now?`,
        String(o.why || 'Your note seems to change something you set yourself.'), [m.id], 'capture')) done.questions++
    } else if (o.op === 'confirm' && byId.has(String(o.id))) {
      await confirmMemory(String(o.id), source, 'capture'); done.confirmed++
    } else if (o.op === 'conflict') {
      const ids = (Array.isArray(o.ids) ? o.ids : []).map(String).filter((id: string) => byId.has(id))
      if (await askTom(String(o.question || ''), String(o.why || ''), ids, 'capture')) done.questions++
    }
  }
  return done
}

/** Learn from notes not yet read, oldest first, starting new ones only within the time given. */
export async function learnFromNotes(opts: { startWithinMs?: number; limit?: number } = {}) {
  const deadline = Date.now() + (opts.startWithinMs ?? 60_000)
  let learned = 0
  while (Date.now() < deadline && learned < (opts.limit ?? 10)) {
    const note = await claimNote()
    if (!note) break
    try {
      const related = await relatedMemories(`${note.text} ${JSON.stringify(note.context || {})}`, 15)
      const raw = await complete({
        provider: 'auto', role: 'memory', temperature: 0.1, maxTokens: 4000, timeoutMs: LEARN_TIMEOUT_MS, json: true,
        system: MEMORY_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify({ note: { from: note.source, written: iso(note.created_at), text: note.text, context: note.context },
          related_memories: related.map((m) => ({ id: m.id, kind: m.kind, subject: m.subject, content: m.content, pinned: m.pinned })) }, null, 1) }],
        payload: { note: note.text, related: related.map((m) => m.id) },
      })
      await applyNoteOps(parseJson(raw).ops, note, related)
      await q(`UPDATE memory_notes SET processed_at = now(), error = NULL WHERE id = $1`, [note.id])
      learned++
    } catch (e) {
      // Kept as it is and tried again by a later run (claimed_at holds it for five minutes); the note itself is never lost.
      await q(`UPDATE memory_notes SET error = $2 WHERE id = $1`, [note.id, String((e as Error).message).slice(0, 500)])
      console.error('Learning from a note failed', note.id, (e as Error).message)
      learned++
    }
  }
  return learned
}
onNote(() => learnFromNotes())

// ---------------------------------------------------------------- the weekly check

/** The Monday of the London week, which names the week. */
export const weekOf = (now: Date = new Date()) => { const p = londonParts(now); return addDays(p.date, -p.weekday) }

/** Due from Sunday 18:00 London, once a week. */
export async function weeklyCheckDue(now: Date = new Date()) {
  const p = londonParts(now)
  if (p.weekday !== 6 || p.time < '18:00') return false
  return !(await one(`SELECT id FROM memory_reviews WHERE trigger = 'weekly' AND week = $1`, [weekOf(now)]))
}

export const reviewOut = (r: Row | null) => (r ? { id: r.id, week: r.week, trigger: r.trigger, status: r.status, summary: r.summary, counts: r.counts || {},
  error: r.error, started_at: iso(r.started_at), finished_at: iso(r.finished_at) } : null)

/** The next Sunday 18:00 London, as a date. */
export function nextWeeklyCheck(now: Date = new Date()) {
  const p = londonParts(now)
  const days = p.weekday === 6 && p.time < '18:00' ? 0 : (6 - p.weekday + 7) % 7 || 7
  return addDays(p.date, days)
}

export async function weeklyCheck(trigger: 'weekly' | 'manual' = 'weekly', now: Date = new Date()) {
  const review = trigger === 'weekly'
    ? await one(`INSERT INTO memory_reviews (week, trigger) VALUES ($1, 'weekly') ON CONFLICT (week) WHERE trigger = 'weekly' DO NOTHING RETURNING *`, [weekOf(now)])
    : await one(`INSERT INTO memory_reviews (week, trigger) VALUES ($1, 'manual') RETURNING *`, [weekOf(now)])
  if (!review) return null // another run took this week's check
  const actor: Actor = 'weekly_check'
  try {
    await learnFromNotes({ startWithinMs: 30_000, limit: 20 }) // the week's notes first, so the check sees them
    const [memories, notes, tasks, waiting] = await Promise.all([
      q(`SELECT * FROM memories WHERE status = 'active' ORDER BY subject, updated_at DESC LIMIT 400`),
      q(`SELECT source, text, created_at FROM memory_notes WHERE created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 80`),
      q(`SELECT title, due_date, status FROM tasks WHERE status <> 'done' ORDER BY priority, created_at DESC LIMIT 40`),
      q(`SELECT question FROM memory_questions WHERE status = 'open'`),
    ])
    const counts = { merged: 0, updated: 0, archived: 0, questions: 0, memories: memories.length, notes: notes.length }
    let summary = 'Nothing to check yet: Aimelia has no memories.'
    if (memories.length || notes.length) {
      const raw = await complete({
        provider: 'auto', role: 'memory_review', temperature: 0.1, maxTokens: 16000, timeoutMs: REVIEW_TIMEOUT_MS, json: true,
        system: MEMORY_REVIEW_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify({
          today: londonParts(now).date,
          memories: memories.map((m) => ({ id: m.id, kind: m.kind, subject: m.subject, content: m.content, pinned: m.pinned,
            as_of: iso(m.confirmed_at || m.updated_at)?.slice(0, 10) })),
          notes_this_week: notes.map((n) => ({ from: n.source, on: iso(n.created_at)?.slice(0, 10), text: clip(n.text, 600) })),
          recent_corrections: await lessonsForContext(10),
          open_tasks: tasks,
          questions_already_waiting: waiting.map((w) => w.question),
        }, null, 1) }],
        payload: { memories: memories.map((m) => m.id), notes: notes.length },
      })
      const out = parseJson(raw)
      const byId = new Map(memories.map((m) => [String(m.id), m]))
      const usable = (id: unknown) => byId.get(String(id))
      const askInstead = async (ids: string[], what: string, why: string) => {
        if (counts.questions >= MAX_QUESTIONS) return
        const named = ids.map((id) => usable(id)).filter(Boolean).map((m) => `"${clip(m!.content, 160)}"`).join(' and ')
        if (await askTom(`The weekly check would ${what} ${named}, which you set yourself. Should it?`, why, ids, actor)) counts.questions++
      }
      for (const m of Array.isArray(out.merges) ? out.merges : []) {
        const ids = [...new Set((Array.isArray(m?.ids) ? m.ids : []).map(String))].filter((id) => usable(id)) as string[]
        if (ids.length < 2 || !String(m.content || '').trim()) continue
        if (ids.some((id) => usable(id)!.pinned)) { await askInstead(ids, 'merge', String(m.why || '')); continue }
        const olds = ids.map((id) => usable(id)!)
        const merged = await addMemory({ kind: m.kind || olds[0].kind, subject: String(m.subject || olds[0].subject), content: String(m.content),
          sources: olds.flatMap((o) => o.sources || []) }, actor, `Merged from ${ids.length} memories. ${clip(m.why, 300)}`)
        for (const o of olds) { await changeMemory(o.id, { status: 'archived' }, actor, `Merged into ${merged?.id}`); byId.delete(o.id) }
        counts.merged++
      }
      for (const u of Array.isArray(out.updates) ? out.updates : []) {
        const m = usable(u?.id)
        if (!m || !String(u.content || '').trim()) continue
        if (m.pinned) { await askInstead([m.id], `change it to "${clip(u.content, 200)}" instead of`, String(u.why || '')); continue }
        if (await changeMemory(m.id, { content: String(u.content) }, actor, String(u.why || ''))) counts.updated++
      }
      for (const a of Array.isArray(out.archive) ? out.archive : []) {
        const m = usable(a?.id)
        if (!m) continue
        if (m.pinned) { await askInstead([m.id], 'archive', String(a.why || '')); continue }
        if (await changeMemory(m.id, { status: 'archived' }, actor, String(a.why || ''))) { counts.archived++; byId.delete(m.id) }
      }
      for (const x of Array.isArray(out.questions) ? out.questions : []) {
        if (counts.questions >= MAX_QUESTIONS) break
        const ids = (Array.isArray(x?.memory_ids) ? x.memory_ids : []).map(String).filter((id: string) => usable(id))
        if (await askTom(String(x?.question || ''), String(x?.why || ''), ids, actor)) counts.questions++
      }
      summary = clip(out.summary, 1500) || 'The check found nothing to change.'
    }
    return reviewOut(await one(`UPDATE memory_reviews SET status = 'done', summary = $2, counts = $3::jsonb, finished_at = now() WHERE id = $1 RETURNING *`,
      [review.id, summary, json(counts)]))
  } catch (e) {
    console.error('Weekly memory check failed', (e as Error).message)
    return reviewOut(await one(`UPDATE memory_reviews SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 RETURNING *`,
      [review.id, String((e as Error).message).slice(0, 500)]))
  }
}

