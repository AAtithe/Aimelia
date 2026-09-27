/**
 * What Aimelia knows: Tom's notes, the memories drawn from them, and every change.
 *
 * - memory_notes keeps everything Tom tells Aimelia, word for word: answers to the agents' questions, feedback,
 *   send-back reasons, task briefs, brain dumps, Ask Aimelia messages and answers to memory questions. A note
 *   outlives the task it came from; only Tom deletes one.
 * - memories are short statements drawn from the notes (see learn.ts). Each keeps the notes it came from.
 * - pinned means Tom wrote or edited the memory. Agents may ask about a pinned memory, never change it.
 * - memory_log records every change: who (tom, capture, weekly_check), what, before and after.
 * - memoryForContext gives the agent team and Ask Aimelia the memories that bear on what they are doing.
 * - a phone or WhatsApp number is kept only when Tom adds it himself. Aimelia's own learning drops a new memory that
 *   carries one, and removes one from any change it makes, since memories go into every agent's instructions.
 */
import { randomUUID } from 'node:crypto'
import { iso, json, one, q, type Row } from '../db'
import { runLater } from '../router'
import { hasPhone, redactPhones } from '../guard'

export const KINDS = ['fact', 'preference', 'person', 'client', 'process'] as const
export type Kind = (typeof KINDS)[number]
export type Actor = 'tom' | 'capture' | 'weekly_check'

export const NOTE_SOURCES = {
  answer: 'Your answer to an agent question',
  feedback: 'Your feedback on a task',
  send_back: 'Your reason for sending a draft back',
  task_brief: 'A task brief you wrote',
  brain_dump: 'A brain dump',
  chat: 'Ask Aimelia',
  memory_answer: 'Your answer to a memory question',
  one_to_one: 'Your 1-2-1 notes',
} as const
export type NoteSource = keyof typeof NOTE_SOURCES

const clip = (t: unknown, n: number) => { const s = String(t ?? '').trim(); return s.length <= n ? s : `${s.slice(0, n)} ...` }
export const asKind = (k: unknown): Kind => (KINDS.includes(k as Kind) ? (k as Kind) : 'fact')

let learnHook: (() => Promise<unknown>) | null = null
/** learn.ts registers itself here, so saving a note starts the learning without an import cycle. */
export function onNote(fn: () => Promise<unknown>) { learnHook = fn }

/**
 * Keep something Tom wrote. Saved at once and learned from after the response; the background timer
 * catches any note that run missed. The same (source, ref) is kept once.
 */
export async function keepNote(source: NoteSource, text: string, context: Record<string, unknown> = {}, ref: string = randomUUID()) {
  const t = String(text || '').trim()
  if (!t) return
  await q(`INSERT INTO memory_notes (source, ref, text, context) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (source, ref) DO NOTHING`,
    [source, ref, t.slice(0, 20_000), json(context)])
  if (learnHook) runLater(learnHook)
}

export const noteOut = (n: Row) => ({
  id: n.id, source: n.source, label: NOTE_SOURCES[n.source as NoteSource] || n.source, text: n.text, context: n.context || {},
  created_at: iso(n.created_at), learned: !!n.processed_at, error: n.processed_at ? null : n.error ?? null,
})

export const memoryOut = (m: Row) => ({
  id: m.id, kind: m.kind, subject: m.subject, content: m.content, status: m.status, pinned: m.pinned, created_by: m.created_by,
  sources: (m.sources || []) as { note_id?: string; source: string; label: string; quote: string; at: string }[],
  created_at: iso(m.created_at), updated_at: iso(m.updated_at), confirmed_at: iso(m.confirmed_at),
})

export const sourceFrom = (n: Row) => ({ note_id: n.id, source: n.source, label: NOTE_SOURCES[n.source as NoteSource] || n.source, quote: clip(n.text, 300), at: iso(n.created_at) })

const snapshot = (m: Row | null) => (m ? { kind: m.kind, subject: m.subject, content: m.content, status: m.status, pinned: m.pinned } : null)

export async function logChange(memoryId: string | null, action: string, actor: Actor, before: Row | null, after: Row | null, note = '') {
  await q(`INSERT INTO memory_log (memory_id, action, actor, before, after, note) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [memoryId, action, actor, json(snapshot(before)), json(snapshot(after)), note.slice(0, 1000)])
}

export async function getMemory(id: string) {
  return one(`SELECT * FROM memories WHERE id::text = $1`, [id])
}

export async function addMemory(m: { kind: unknown; subject: string; content: string; sources?: unknown[]; pinned?: boolean }, actor: Actor, note = '') {
  const content = clip(m.content, 1000)
  if (!content) return null
  if (actor !== 'tom' && hasPhone(content)) return null // only Tom keeps a number
  const row = (await one(`INSERT INTO memories (kind, subject, content, pinned, sources, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
    [asKind(m.kind), clip(m.subject, 200), content, !!m.pinned || actor === 'tom', json(m.sources || []), actor === 'tom' ? 'tom' : 'aimelia']))!
  await logChange(row.id, 'added', actor, null, row, note)
  return row
}

/**
 * Change a memory. Tom's edits pin it. An agent may not change a pinned memory: the call returns null and the
 * caller asks Tom instead.
 */
export async function changeMemory(id: string, patch: { kind?: unknown; subject?: string; content?: string; status?: 'active' | 'archived'; pinned?: boolean; source?: unknown },
  actor: Actor, note = '') {
  const before = await getMemory(id)
  if (!before) return null
  if (actor !== 'tom' && before.pinned) return null
  const proposed = patch.content !== undefined && actor !== 'tom' ? redactPhones(patch.content) : patch.content // only Tom adds a number
  const content = proposed !== undefined ? clip(proposed, 1000) || before.content : before.content
  const edited = content !== before.content || (patch.subject !== undefined && patch.subject !== before.subject) || (patch.kind !== undefined && asKind(patch.kind) !== before.kind)
  const pinned = patch.pinned !== undefined ? patch.pinned : actor === 'tom' && edited ? true : before.pinned
  const sources = patch.source ? [...(before.sources || []), patch.source] : before.sources || []
  const after = (await one(`UPDATE memories SET kind = $2, subject = $3, content = $4, status = $5, pinned = $6, sources = $7::jsonb, updated_at = now()
    WHERE id = $1 RETURNING *`, [before.id, patch.kind !== undefined ? asKind(patch.kind) : before.kind, patch.subject !== undefined ? clip(patch.subject, 200) : before.subject,
    content, patch.status ?? before.status, pinned, json(sources)]))!
  const action = patch.status && patch.status !== before.status ? (patch.status === 'archived' ? 'archived' : 'restored')
    : edited ? 'edited' : patch.pinned !== undefined && patch.pinned !== before.pinned ? (patch.pinned ? 'pinned' : 'unpinned') : 'updated'
  await logChange(after.id, action, actor, before, after, note)
  return after
}

/** Seen again in a new note: the date it was last confirmed moves on and the note is added to its sources. */
export async function confirmMemory(id: string, source: unknown, actor: Actor) {
  const m = await getMemory(id)
  if (!m) return
  await q(`UPDATE memories SET confirmed_at = now(), sources = sources || $2::jsonb WHERE id = $1`, [m.id, json([source])])
  await logChange(m.id, 'confirmed', actor, m, m)
}

export async function askTom(question: string, why: string, memoryIds: string[], askedBy: Actor) {
  const text = clip(question, 500)
  if (!text) return null
  // The same question is never asked twice while one is waiting.
  const waiting = await one(`SELECT id FROM memory_questions WHERE status = 'open' AND lower(question) = lower($1)`, [text])
  if (waiting) return null
  return one(`INSERT INTO memory_questions (question, why, memory_ids, asked_by) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
    [text, clip(why, 500), json(memoryIds), askedBy])
}

export const questionOut = (x: Row, byId: Map<string, Row> = new Map()) => ({
  id: x.id, question: x.question, why: x.why, asked_by: x.asked_by, status: x.status, answer: x.answer, created_at: iso(x.created_at),
  memories: ((x.memory_ids || []) as string[]).map((id) => byId.get(id)).filter(Boolean).map((m) => ({ id: m!.id, subject: m!.subject, content: m!.content })),
})

/** Active memories matching the words in text, best first. A long text matches on any of its words. */
export async function relatedMemories(text: string, limit = 15): Promise<Row[]> {
  const words = [...new Set(String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [])].slice(0, 24)
  if (!words.length) return []
  return q(`SELECT *, ts_rank(tsv, to_tsquery('english', $1)) AS rank FROM memories
            WHERE status = 'active' AND tsv @@ to_tsquery('english', $1) ORDER BY rank DESC, updated_at DESC LIMIT $2`, [words.join(' | '), limit])
}

/**
 * What the agent team and Ask Aimelia are given: Tom's standing preferences and ways of working (always), then the
 * memories that bear on the text. Plain statements with the date they were last confirmed.
 */
export async function memoryForContext(text: string, limit = 20) {
  const standing = await q(`SELECT * FROM memories WHERE status = 'active' AND kind IN ('preference', 'process') ORDER BY pinned DESC, updated_at DESC LIMIT 8`)
  const related = await relatedMemories(text, limit)
  const seen = new Set<string>()
  const out: { about: string; memory: string; kind: string; from_tom: boolean; as_of: string | null }[] = []
  for (const m of [...standing, ...related]) {
    if (seen.has(m.id) || out.length >= limit) continue
    seen.add(m.id)
    out.push({ about: m.subject, memory: m.content, kind: m.kind, from_tom: m.pinned, as_of: iso(m.confirmed_at || m.updated_at)?.slice(0, 10) ?? null })
  }
  return out
}

export const MEMORY_GUIDANCE = 'Facts Tom has told Aimelia before. Use them rather than asking him again. from_tom means he wrote or checked it himself. '
  + 'If the task, or anything you are told, contradicts one of them, say so in your summary and ask Tom which is right.'

/**
 * Once, on the first run after memory was added: bring in what Tom wrote before it existed, with its original date.
 * Answered questions, feedback and send-back reasons, task briefs he wrote, and his Ask Aimelia messages.
 * The same refs as live capture, so nothing is kept twice. Returns how many notes were added, or null if done before.
 */
export async function keepEarlierNotes(): Promise<number | null> {
  const first = await one(`INSERT INTO app_config (key, value) VALUES ('memory_backfilled', now()::text) ON CONFLICT (key) DO NOTHING RETURNING key`)
  if (!first) return null
  const added = await q(`INSERT INTO memory_notes (source, ref, text, context, created_at)
      SELECT 'answer', 'question:' || qn.id, qn.answer, jsonb_build_object('question', qn.question, 'task', t.title), COALESCE(qn.answered_at, qn.created_at)
        FROM questions qn JOIN tasks t ON t.id = qn.task_id WHERE qn.status = 'answered' AND coalesce(qn.answer, '') <> ''
      UNION ALL
      SELECT CASE WHEN l.source = 'feedback' THEN 'feedback' ELSE 'send_back' END, 'lesson:' || l.id, l.note, jsonb_build_object('task', l.task_title), l.created_at
        FROM lessons l WHERE l.source IN ('feedback', 'rejection') AND l.note <> ''
      UNION ALL
      SELECT 'task_brief', 'task:' || t.id, t.title || E'\n\n' || t.notes, jsonb_build_object('task', t.title), t.created_at
        FROM tasks t WHERE t.kind = 'task' AND t.source IS NULL AND t.notes <> ''
      UNION ALL
      SELECT 'chat', 'chat:' || m.id, m.content, jsonb_build_object('conversation', c.title), m.created_at
        FROM chat_messages m JOIN chats c ON c.id = m.chat_id WHERE m.role = 'user' AND length(trim(m.content)) >= 20
    ON CONFLICT (source, ref) DO NOTHING RETURNING id`)
  return added.length
}

/**
 * For Ask Aimelia's instructions: what Tom has set himself (checked by him) and his standing preferences, then the
 * memories that bear on his message. With ids, so it can forget one when he says it is wrong.
 */
export async function rememberedFor(message: string, limit = 80): Promise<{ id: string; fact: string }[]> {
  const standing = await q(`SELECT * FROM memories WHERE status = 'active' AND (pinned OR kind IN ('preference', 'process'))
                            ORDER BY updated_at DESC LIMIT $1`, [limit - 20])
  const related = await relatedMemories(message, 20)
  const seen = new Set<string>()
  return [...standing, ...related].filter((m) => !seen.has(m.id) && seen.add(m.id))
    .map((m) => ({ id: m.id, fact: m.subject ? `${m.subject}: ${m.content}` : m.content }))
}

/**
 * Ask Aimelia first kept remembered facts in chat_memory. They now live here with everything else: moved across,
 * marked as Tom's (he asked for each one), with their original date. Cheap when there is nothing to move.
 */
export async function moveChatMemory(): Promise<number> {
  const moved = await q(`WITH gone AS (DELETE FROM chat_memory RETURNING fact, created_at)
    INSERT INTO memories (kind, content, pinned, created_by, sources, created_at, updated_at)
    SELECT 'fact', left(fact, 1000), true, 'tom',
      jsonb_build_array(jsonb_build_object('source', 'chat', 'label', 'You told Ask Aimelia', 'quote', left(fact, 300), 'at', created_at)), created_at, created_at
    FROM gone RETURNING *`)
  for (const m of moved) await logChange(m.id, 'added', 'tom', null, m, 'Moved from Ask Aimelia\'s earlier memory')
  return moved.length
}
