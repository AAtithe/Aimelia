/**
 * What Aimelia knows, mounted under /api/todo/memory: the memories, Tom's notes, the questions from the checks,
 * the history of every change, and the weekly check. Tom can add, edit, pin, archive and delete anything here.
 */
import { z } from 'zod'
import { iso, one, q } from '../db'
import { body, fail } from '../http'
import { runLater, type Endpoint } from '../router'
import { addMemory, changeMemory, getMemory, keepNote, KINDS, logChange, memoryOut, noteOut, questionOut } from './store'
import { learnFromNotes, nextWeeklyCheck, reviewOut, weeklyCheck } from './learn'

const kind = z.enum(KINDS)
const MemoryIn = z.object({ kind: kind.default('fact'), subject: z.string().trim().max(200).default(''), content: z.string().trim().min(1).max(1000) })
const MemoryPatch = z.object({ kind: kind.optional(), subject: z.string().trim().max(200).optional(), content: z.string().trim().min(1).max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(), pinned: z.boolean().optional() })
const Answer = z.object({ answer: z.string().trim().min(1).max(4000) })

/** A check still marked running after ten minutes was stopped part way (the server allows five). */
const RUNNING = `status = 'running' AND started_at > now() - interval '10 minutes'`

export const memoryEndpoints: Endpoint[] = [
  ['GET', '/memory', async (req) => {
    const u = new URL(req.url)
    const text = (u.searchParams.get('q') || '').trim()
    const status = u.searchParams.get('status') === 'archived' ? 'archived' : 'active'
    const words = text.toLowerCase().match(/[a-z0-9]{2,}/g)?.slice(0, 12).map((w) => `${w}:*`).join(' & ')
    const [memories, counts, questions, review, waiting] = await Promise.all([
      words
        ? q(`SELECT * FROM memories WHERE status = $1 AND tsv @@ to_tsquery('english', $2) ORDER BY ts_rank(tsv, to_tsquery('english', $2)) DESC LIMIT 300`, [status, words])
        : q(`SELECT * FROM memories WHERE status = $1 ORDER BY kind, subject, updated_at DESC LIMIT 500`, [status]),
      q(`SELECT status, count(*)::int AS n FROM memories GROUP BY status`),
      q(`SELECT * FROM memory_questions WHERE status = 'open' ORDER BY created_at`),
      one(`SELECT * FROM memory_reviews ORDER BY started_at DESC LIMIT 1`),
      one(`SELECT count(*)::int AS n FROM memory_notes WHERE processed_at IS NULL`),
    ])
    const ids = [...new Set(questions.flatMap((x) => x.memory_ids || []))]
    const linked = ids.length ? await q(`SELECT id, subject, content FROM memories WHERE id::text = ANY($1)`, [ids]) : []
    const byId = new Map(linked.map((m) => [String(m.id), m]))
    const c = Object.fromEntries(counts.map((r) => [r.status, r.n]))
    return {
      memories: memories.map(memoryOut), counts: { active: c.active || 0, archived: c.archived || 0 },
      questions: questions.map((x) => questionOut(x, byId)),
      review: reviewOut(review), review_running: !!(review && review.status === 'running' && Date.now() - new Date(review.started_at).getTime() < 600_000),
      next_check: nextWeeklyCheck(), notes_waiting: waiting?.n ?? 0,
    }
  }],
  ['POST', '/memory', async (req) => {
    const b = await body(req, MemoryIn)
    return Response.json(memoryOut((await addMemory({ ...b, sources: [{ source: 'tom', label: 'You added this', quote: '', at: new Date().toISOString() }] }, 'tom'))!), { status: 201 })
  }],
  ['GET', '/memory/notes', async (req) => {
    const u = new URL(req.url)
    const before = u.searchParams.get('before')
    const rows = await q(`SELECT * FROM memory_notes WHERE ($1::timestamptz IS NULL OR created_at < $1::timestamptz) ORDER BY created_at DESC LIMIT 50`, [before || null])
    const total = await one(`SELECT count(*)::int AS n FROM memory_notes`)
    return { notes: rows.map(noteOut), total: total?.n ?? 0, more: rows.length === 50 ? iso(rows.at(-1)!.created_at) : null }
  }],
  ['DELETE', '/memory/notes/:id', async (_r, p) => {
    // Forgets the note itself. Memories drawn from it stay until Tom changes them; the page says so.
    const r = await q(`DELETE FROM memory_notes WHERE id::text = $1 RETURNING id`, [p.id])
    if (!r.length) fail(404, 'Note not found.')
  }],
  ['GET', '/memory/log', async () => {
    const rows = await q(`SELECT l.*, m.subject AS now_subject FROM memory_log l LEFT JOIN memories m ON m.id = l.memory_id ORDER BY l.id DESC LIMIT 100`)
    return { log: rows.map((l) => ({ id: l.id, memory_id: l.memory_id, action: l.action, actor: l.actor, before: l.before, after: l.after, note: l.note,
      subject: l.after?.subject || l.before?.subject || l.now_subject || '', at: iso(l.created_at) })) }
  }],
  ['POST', '/memory/check', async () => {
    if (await one(`SELECT id FROM memory_reviews WHERE ${RUNNING}`)) fail(409, 'A check is already running.')
    runLater(() => weeklyCheck('manual'))
    return Response.json({ started: true }, { status: 202 })
  }],
  ['POST', '/memory/questions/:id/answer', async (req, p) => {
    const b = await body(req, Answer)
    const x = (await one(`UPDATE memory_questions SET status = 'answered', answer = $2, answered_at = now() WHERE id::text = $1 AND status = 'open' RETURNING *`, [p.id, b.answer]))
      || fail(404, 'Question not found, or already answered.')
    const about = (await q(`SELECT subject, content FROM memories WHERE id::text = ANY($1)`, [x!.memory_ids || []]))
    // The answer is a note like any other: the memory is corrected from it, and it is kept.
    await keepNote('memory_answer', b.answer, { question: x!.question, about: about.map((m) => `${m.subject}: ${m.content}`) }, `question:${x!.id}`)
    return questionOut(x!)
  }],
  ['POST', '/memory/questions/:id/dismiss', async (_r, p) => {
    const x = (await one(`UPDATE memory_questions SET status = 'dismissed', answered_at = now() WHERE id::text = $1 AND status = 'open' RETURNING *`, [p.id]))
      || fail(404, 'Question not found, or already dealt with.')
    return questionOut(x!)
  }],
  ['POST', '/memory/learn', async () => ({ learned: await learnFromNotes({ startWithinMs: 60_000 }) })],
  ['GET', '/memory/:id', async (_r, p) => {
    const m = (await getMemory(p.id)) || fail(404, 'Memory not found.')
    const log = await q(`SELECT * FROM memory_log WHERE memory_id = $1 ORDER BY id`, [m!.id])
    return { memory: memoryOut(m!), history: log.map((l) => ({ action: l.action, actor: l.actor, before: l.before, after: l.after, note: l.note, at: iso(l.created_at) })) }
  }],
  ['PATCH', '/memory/:id', async (req, p) => {
    const b = await body(req, MemoryPatch)
    return memoryOut((await changeMemory(p.id, b, 'tom')) || fail(404, 'Memory not found.'))
  }],
  ['DELETE', '/memory/:id', async (_r, p) => {
    const m = (await getMemory(p.id)) || fail(404, 'Memory not found.')
    await q(`DELETE FROM memories WHERE id = $1`, [m!.id])
    await logChange(m!.id, 'deleted', 'tom', m!, null)
  }],
]
