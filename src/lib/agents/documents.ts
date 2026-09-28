/**
 * Documents attached to a task: policies, procedures, risk assessments, letters, contracts, photos of paperwork.
 *
 * - Each file is checked as Ask Aimelia checks files (the type from its first bytes), then stored with the task.
 * - Claude reads each one once, every page, and assesses it for the task: a section-by-section summary, findings rated
 *   red, amber or green with the requirement each is judged against, what is missing, and questions for Tom.
 *   One read per file keeps the cost down: the agents work from that assessment, not from the pages every time.
 * - The task waits while its files are being read (claimNext skips it), then goes to the agent team, who work it
 *   through: the assessment as a document, the changes as a checklist, and handovers where someone else must act.
 * - Reads run after the upload's response, and the background timer picks up any that were cut off; two tries each.
 * - Tom can also keep a document in the knowledge base, so Ask Aimelia and the email features can draw on it.
 */
import { iso, json, one, q, type Row } from '../db'
import { env } from '../env'
import { fail, HttpError } from '../http'
import { complete, parseJson, type Message } from '../llm'
import { londonToday } from '../dates'
import { index } from '../email/knowledge'
import { readChatFile } from '../chat/files'
import { DOCUMENT_PROMPT, EVIDENCE_PROMPT } from './defaults'
import { logEvent } from './orchestrator'

export const MAX_TASK_FILES = 10
const READ_TIMEOUT_MS = 240_000
const STALE_MINUTES = 7
const MAX_ATTEMPTS = 2
const MAX_TEXT_TO_READ = 150_000
const MAX_TEXT_FOR_AGENTS = 40_000
const RATINGS = new Set(['red', 'amber', 'green'])
const clip = (t: unknown, n: number) => { const s = String(t ?? '').trim(); return s.length <= n ? s : `${s.slice(0, n)} ...` }

export const fileOut = (f: Row) => ({
  id: f.id, name: f.name, kind: f.kind, size: f.size, purpose: f.purpose, keep: f.keep, status: f.status as 'reading' | 'ready' | 'failed',
  reading: f.reading ?? null, error: f.error, created_at: iso(f.created_at), read_at: iso(f.read_at),
  role: (f.role || 'document') as 'document' | 'evidence', question_id: f.question_id ?? null,
})
export const FILE_COLS = `id, task_id, name, kind, size, purpose, keep, status, reading, error, created_at, read_at, role, question_id`

/** Store the files on the task and queue them to be read. The task is queued too, and waits for the reads. */
export async function attachFiles(taskId: string, files: { name: string; data: string }[], o: { purpose?: string; keep?: boolean; questionId?: string } = {}) {
  const have = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM task_files WHERE task_id = $1`, [taskId]))!.n
  if (have + files.length > MAX_TASK_FILES) fail(422, `A task can hold ${MAX_TASK_FILES} documents; this one has ${have}. Remove one first.`)
  const read = files.map((f) => readChatFile(f.name, f.data)) // every file is checked before anything is stored
  if (read.some((f) => f.kind !== 'text') && !env.anthropicKey()) {
    fail(503, 'Reading PDFs and photos needs the Claude (Anthropic) API key. Add it in Settings, or attach the document as Word or text.')
  }
  const made: Row[] = []
  for (const f of read) {
    made.push((await one(`INSERT INTO task_files (task_id, name, kind, media_type, size, data, text, purpose, keep, role, question_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${FILE_COLS}`,
      [taskId, f.name, f.kind, f.media_type, f.size, f.data, f.text, clip(o.purpose, 1000), !!o.keep, o.questionId ? 'evidence' : 'document', o.questionId ?? null]))!)
  }
  // Files given with an answer wait for the answer, which puts the task back with the team.
  if (!o.questionId) await q(`UPDATE tasks SET status = 'queued', updated_at = now() WHERE id = $1 AND status NOT IN ('processing', 'needs_input')`, [taskId])
  await logEvent(taskId, 'documents', 'tom', o.questionId
    ? { attached: read.map((f) => f.name), with_answer_to: o.purpose || null }
    : { attached: read.map((f) => f.name), check_against: o.purpose || null })
  return made
}

async function claimFile(): Promise<Row | null> {
  for (;;) {
    const f = await one(`UPDATE task_files SET claimed_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM task_files WHERE status = 'reading' AND (claimed_at IS NULL OR claimed_at < now() - ($1 || ' minutes')::interval)
                  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`, [String(STALE_MINUTES)])
    if (!f) return null
    if (f.attempts <= MAX_ATTEMPTS) return f
    await finish(f, 'failed', null, 'Claude did not finish reading it after two tries. Split it into smaller parts, or attach the sections that matter.')
  }
}

/** A reading as the agents and the screen use it, whatever shape the model returned. */
export function cleanReading(r: any) {
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  return {
    summary: clip(r?.summary, 2000),
    overall: ['sound', 'needs work', 'not fit for purpose'].includes(r?.overall) ? r.overall : null,
    sections: list(r?.sections).slice(0, 80).map((s: any) => ({ ref: clip(s?.ref, 40), title: clip(s?.title, 200), says: clip(s?.says, 600) })),
    findings: list(r?.findings).slice(0, 80).filter((x: any) => x && String(x.finding || '').trim()).map((x: any) => ({
      ref: clip(x.ref, 40), rating: RATINGS.has(String(x.rating).toLowerCase()) ? String(x.rating).toLowerCase() : 'amber',
      finding: clip(x.finding, 1000), requirement: clip(x.requirement, 400), change: clip(x.change, 1000) })),
    missing: list(r?.missing).slice(0, 30).map((m) => clip(m, 400)).filter(Boolean),
    questions: list(r?.questions).slice(0, 10).map((m) => clip(m, 400)).filter(Boolean),
    // Files given with an answer: what they show.
    ...(r?.answer || r?.facts ? { answer: clip(r?.answer, 4000), facts: list(r?.facts).slice(0, 40).map((m) => clip(m, 400)).filter(Boolean),
      open: list(r?.open).slice(0, 10).map((m) => clip(m, 400)).filter(Boolean) } : {}),
  }
}

async function finish(f: Row, status: 'ready' | 'failed', reading: unknown, error: string | null) {
  await q(`UPDATE task_files SET status = $2, reading = $3::jsonb, error = $4, read_at = now() WHERE id = $1`, [f.id, status, reading === null ? null : json(reading), error])
  await logEvent(f.task_id, 'documents', 'reader', status === 'ready' ? { read: f.name, overall: (reading as any)?.overall ?? null } : { could_not_read: f.name, error })
}

/** Read and assess one file for its task. */
async function readOne(f: Row) {
  const task = (await one(`SELECT title, notes FROM tasks WHERE id = $1`, [f.task_id]))!
  const evidence = f.role === 'evidence'
  const brief = evidence
    ? { task: { title: task.title, notes: task.notes || '' }, file: f.name, question_tom_was_answering: f.purpose || '(not recorded)', today: londonToday() }
    : { task: { title: task.title, notes: task.notes || '' }, document: f.name, check_it_against: f.purpose || '(nothing more said)', today: londonToday() }
  const message: Message = f.kind === 'text'
    ? { role: 'user', content: `${JSON.stringify(brief, null, 1)}\n\nThe document:\n${clip(f.text, MAX_TEXT_TO_READ)}` }
    : { role: 'user', content: JSON.stringify(brief, null, 1), ...(f.kind === 'image' ? { files: [{ kind: 'image' as const, media_type: f.media_type, data: f.data, name: f.name }] } : {}) }
  const raw = await complete({
    provider: f.kind === 'text' ? 'auto' : 'anthropic', role: 'document', temperature: 0.1, maxTokens: 16000, timeoutMs: READ_TIMEOUT_MS, json: true,
    system: evidence ? EVIDENCE_PROMPT : DOCUMENT_PROMPT, messages: [message], ...(f.kind === 'pdf' ? { pdf: f.data } : {}), payload: brief,
  })
  return cleanReading(parseJson(raw))
}

/**
 * Read queued files, starting new ones only within the time given. When a task's last file is read, the task goes
 * back to the agents (unless they are waiting on Tom). Returns how many files were dealt with.
 */
export async function readTaskFiles(opts: { startWithinMs?: number; limit?: number } = {}) {
  const deadline = Date.now() + (opts.startWithinMs ?? 30_000)
  let done = 0
  while (Date.now() < deadline && done < (opts.limit ?? 5)) {
    const f = await claimFile()
    if (!f) break
    try {
      const reading = await readOne(f)
      await finish(f, 'ready', reading, null)
      if (f.keep) {
        const body = f.kind === 'text' ? String(f.text) : [reading.summary, ...reading.sections.map((s) => `${s.ref} ${s.title}: ${s.says}`)].join('\n')
        await index('policy', `task-file-${f.id}`, f.name, body).catch((e) => console.error('Keeping a document in the knowledge base failed', (e as Error).message))
      }
    } catch (e) {
      const msg = e instanceof HttpError ? e.message : `Claude could not read ${f.name}: ${(e as Error).message}`
      console.error('Reading a task document failed', f.id, msg)
      // Tried again by a later run; the last try fails it with the reason.
      if (f.attempts >= MAX_ATTEMPTS) await finish(f, 'failed', null, msg.slice(0, 500))
      else await q(`UPDATE task_files SET error = $2 WHERE id = $1`, [f.id, msg.slice(0, 500)])
    }
    done++
  }
  return done
}

/** What the agents are given about a task's documents, and how to use them. */
export async function documentsForContext(taskId: string) {
  const all = await q(`SELECT name, kind, text, purpose, status, reading, error, role FROM task_files WHERE task_id = $1 AND status <> 'reading' ORDER BY created_at`, [taskId])
  if (!all.length) return null
  const given = all.filter((f) => f.role === 'evidence')
  const rows = all.filter((f) => f.role !== 'evidence')
  const evidence = given.length ? {
    files_tom_gave_with_his_answers: given.map((f) => f.status === 'failed'
      ? { name: f.name, in_answer_to: f.purpose || null, could_not_be_read: f.error }
      : { name: f.name, in_answer_to: f.purpose || null, what_it_is: f.reading?.summary || null, what_it_shows: f.reading?.answer || null,
          facts: f.reading?.facts || [], still_open: f.reading?.open || [], ...(f.kind === 'text' ? { full_text: clip(f.text, MAX_TEXT_FOR_AGENTS) } : {}) }),
    how_to_use_those_files: 'Tom gave these as part of his answers. Treat what they show as his answer: use the facts exactly, and do not ask again for anything they settle. If one could not be read, say so and work from his written answer.',
  } : {}
  if (!rows.length) return evidence
  return {
    ...evidence,
    documents: rows.map((f) => f.status === 'failed'
      ? { name: f.name, could_not_be_read: f.error }
      : { name: f.name, check_it_against: f.purpose || null, ...f.reading, ...(f.kind === 'text' ? { full_text: clip(f.text, MAX_TEXT_FOR_AGENTS) } : {}) }),
    how_to_use_the_documents: 'Tom attached these documents to this task, and each has been read and assessed. Work the assessment through: '
      + 'check it, correct it where the findings are wrong, and turn it into the actions Tom needs. Include one document action setting out the assessment '
      + '(overall view, then every red and amber finding with its section, the requirement and the change), a checklist of the changes in order of risk, '
      + 'and handovers where someone else must act. Quote section numbers. If a document could not be read, say so. Never say a document is compliant '
      + 'without saying what it was checked against.',
  }
}
