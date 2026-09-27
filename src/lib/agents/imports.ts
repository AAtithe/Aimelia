/**
 * Importing tasks from somewhere else: Word documents and notes, meeting notes and transcripts,
 * Fireflies meetings, and Microsoft To Do.
 *
 * - Documents and meetings are read by the AI, which keeps only the actions. Without an AI key the
 *   bullets, numbered items and "Action:" lines are taken instead, so nothing is lost.
 * - PDFs go to Claude whole, as a document, so scanned pages and tables are read too. They need the
 *   Claude key; there is no fallback, because without Claude there is no text to fall back to.
 * - A list (To Do, Outlook tasks CSV, pasted lines) is already tasks: one task per item, no AI.
 * - Every import is recorded by source and reference, so the same document, meeting or To Do task
 *   is never imported twice by accident. The record is claimed before any task is written.
 * - Everything imported goes to Triage like any other task: Do, Delegate, Defer or Drop.
 * - Microsoft To Do and Fireflies are read only. Nothing is changed or marked complete there.
 */
import { createHash } from 'node:crypto'
import { iso, one, q, type Row } from '../db'
import { env } from '../env'
import { fail, HttpError } from '../http'
import { completeJson } from '../llm'
import { graph, GraphError } from '../microsoft'
import { londonToday } from '../dates'
import { IMPORT_PROMPT } from './defaults'
import { getPipeline } from './orchestrator'
import { actionLines, htmlToText, stripBullet } from './importText'

export type Item = { title: string; notes: string; priority: number; due_date: string | null }
export type Source = 'document' | 'meeting' | 'list' | 'microsoft_todo' | 'fireflies'

export const SOURCE_LABEL: Record<Source, string> = {
  document: 'a document', meeting: 'meeting notes', list: 'a task list', microsoft_todo: 'Microsoft To Do', fireflies: 'Fireflies',
}
const MAX_TASKS = 60
const MAX_TEXT = 60_000

const ymdOrNull = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const clampPriority = (v: unknown) => { const n = parseInt(String(v), 10); return Number.isFinite(n) ? Math.min(Math.max(n, 1), 3) : 2 }
export const fingerprint = (text: string) => createHash('sha256').update(text.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex').slice(0, 32)

// ---------------------------------------------------------------- reading actions out of text

/** The actions in a document or meeting, as tasks. Owners other than Tom are kept in the notes so Triage can delegate. */
export async function extractActions(text: string, kind: 'document' | 'meeting', title: string, pdf?: string): Promise<Item[]> {
  const pipeline = await getPipeline()
  if (pdf && !env.anthropicKey()) fail(503, 'Reading PDFs needs the Claude (Anthropic) API key. Add it in Settings, or copy the text out of the PDF and paste it.')
  const clipped = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n[... the rest was cut to fit]` : text
  let reply: any
  try {
    reply = await completeJson({
      provider: pdf ? 'anthropic' : 'auto', role: 'import', temperature: 0.2, maxTokens: 8000, pdf,
      system: `${IMPORT_PROMPT}\n\nHouse rules:\n${pipeline.house_rules}\n\nTom's team:\n${pipeline.team_directory || '(not given)'}`,
      payload: { source: kind === 'meeting' ? 'meeting notes or transcript' : 'document', title, today: londonToday(),
        text: pdf ? '(The document is the attached PDF. Read every page, including tables and scanned pages.)' : clipped },
    })
  } catch (e) {
    if (pdf) fail(502, `Claude could not read that PDF: ${(e as Error).message}`)
    // Never lose an import because the AI is down: take the lines that look like actions.
    console.error('Import extraction failed, falling back to marked lines', (e as Error).message)
    reply = { tasks: actionLines(text, MAX_TASKS).map((t) => ({ title: t })) }
  }
  const out: Item[] = []
  for (const t of Array.isArray(reply?.tasks) ? reply.tasks : []) {
    const name = String(t?.title || '').trim()
    if (!name) continue
    const owner = String(t.owner || '').trim()
    const notes = [String(t.notes || '').trim(), owner && !/^tom\b/i.test(owner) ? `Owner named: ${owner}` : ''].filter(Boolean).join('\n')
    out.push({ title: name.slice(0, 500), notes, priority: clampPriority(t.priority), due_date: ymdOrNull(t.due_date) })
  }
  return out.slice(0, MAX_TASKS)
}

/** A plain list: one task per line, list markers stripped. */
export function listItems(text: string): Item[] {
  const seen = new Set<string>()
  const out: Item[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const title = stripBullet(line)
    if (!title || seen.has(title.toLowerCase())) continue
    seen.add(title.toLowerCase())
    out.push({ title: title.slice(0, 500), notes: '', priority: 2, due_date: null })
  }
  return out.slice(0, 500)
}

/** RFC 4180 CSV into rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim()))
}

/** "31/10/2026", "2026-10-31" or "31-10-26" to YYYY-MM-DD. UK order: day first. */
export function ukDate(v: string): string | null {
  const s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A CSV of tasks, as Outlook's Export to a file or a spreadsheet writes it. The title column is the first of
 * Subject, Title, Task or Name; Due Date, Priority or Importance, and Notes, Body or Description are used when present.
 * Rows marked complete are skipped. A CSV with no recognisable header is read as one task per first cell.
 */
export function csvItems(text: string): Item[] {
  const rows = parseCsv(text)
  if (!rows.length) return []
  const head = rows[0].map((h) => h.trim().toLowerCase())
  const col = (...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i } return -1 }
  const title = col('subject', 'title', 'task', 'task name', 'name')
  if (title < 0) return listItems(rows.map((r) => r[0]).join('\n'))
  const due = col('due date', 'due', 'due_date', 'deadline')
  const pri = col('priority', 'importance')
  const notes = col('notes', 'body', 'description', 'details')
  const done = col('complete', 'completed', 'status', 'date completed')
  const out: Item[] = []
  for (const r of rows.slice(1)) {
    const name = (r[title] || '').trim()
    if (!name) continue
    const d = done >= 0 ? (r[done] || '').trim().toLowerCase() : ''
    if (d === 'true' || d === 'yes' || d === 'completed' || d === 'complete' || (head[done] === 'date completed' && d)) continue
    const p = pri >= 0 ? (r[pri] || '').toLowerCase() : ''
    out.push({ title: name.slice(0, 500), notes: notes >= 0 ? (r[notes] || '').trim() : '', due_date: due >= 0 ? ukDate(r[due] || '') : null,
      priority: /high|urgent|^1$/.test(p) ? 1 : /low|^3$/.test(p) ? 3 : 2 })
  }
  return out.slice(0, 500)
}

// ---------------------------------------------------------------- saving

export type Saved = { duplicate: false; tasks: Row[] } | { duplicate: true; imported_at: string | null; task_count: number; title: string }

/**
 * Record the import, then write its tasks. The (source, ref) row is claimed first, so two imports of
 * the same thing at once cannot both write tasks. force imports again anyway.
 */
export async function saveImport(o: { source: Source; ref: string; title: string; items: Item[]; force?: boolean }): Promise<Saved> {
  let claimed = await one(`INSERT INTO imports (source, ref, title) VALUES ($1, $2, $3) ON CONFLICT (source, ref) DO NOTHING RETURNING id`,
    [o.source, o.ref, o.title.slice(0, 500)])
  if (!claimed) {
    const prior = (await one(`SELECT * FROM imports WHERE source = $1 AND ref = $2`, [o.source, o.ref]))!
    if (!o.force) return { duplicate: true, imported_at: iso(prior.created_at), task_count: prior.task_count, title: prior.title }
    claimed = prior
  }
  const origin = `Imported from ${SOURCE_LABEL[o.source]}${o.title ? `: ${o.title}` : ''}.`
  const tasks: Row[] = []
  for (const it of o.items) {
    tasks.push((await one(`INSERT INTO tasks (title, notes, priority, due_date, source, last_touched_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
      [it.title, [it.notes, origin].filter(Boolean).join('\n\n'), it.priority, it.due_date, o.source]))!)
  }
  await q(`UPDATE imports SET task_count = task_count + $2, created_at = now() WHERE id = $1`, [claimed.id, tasks.length])
  return { duplicate: false, tasks }
}

export async function importHistory(limit = 15) {
  const rows = await q(`SELECT source, title, task_count, created_at FROM imports WHERE source <> 'microsoft_todo' ORDER BY created_at DESC LIMIT $1`, [limit])
  const todo = await one<{ n: number; last: string | null }>(`SELECT count(*)::int AS n, max(created_at) AS last FROM imports WHERE source = 'microsoft_todo'`)
  return {
    recent: rows.map((r) => ({ source: r.source, label: SOURCE_LABEL[r.source as Source] || r.source, title: r.title, task_count: r.task_count, imported_at: iso(r.created_at) })),
    microsoft_todo_imported: todo?.n ?? 0,
    microsoft_todo_last: iso(todo?.last ?? null),
  }
}

// ---------------------------------------------------------------- Microsoft To Do

const TODO_PERMISSION = 'Microsoft 365 has not given Aimelia access to To Do yet. Connect Microsoft 365 again from Settings and accept the Tasks permission.'

async function todoGraph<T>(path: string, query?: Record<string, string>): Promise<T> {
  try {
    return await graph<T>('GET', path, { query })
  } catch (e) {
    if (e instanceof GraphError && /HTTP 403/.test(e.message)) throw new HttpError(403, TODO_PERMISSION)
    throw e
  }
}

export async function todoLists() {
  const r = await todoGraph<{ value: { id: string; displayName: string; wellknownListName?: string }[] }>('/me/todo/lists')
  return (r.value || []).map((l) => ({ id: l.id, name: l.displayName, kind: l.wellknownListName || 'none' }))
}

type TodoTask = {
  id: string; title: string; status: string; importance?: string; body?: { content?: string; contentType?: string }
  dueDateTime?: { dateTime: string }; checklistItems?: { displayName: string; isChecked: boolean }[]
}

/** A To Do task as an Aimelia task. Due dates arrive as a wall-clock date in the list's zone; the date part is kept. */
export function todoItem(t: TodoTask, listName: string): Item {
  const body = t.body?.content ? (t.body.contentType === 'html' ? htmlToText(t.body.content) : t.body.content.trim()) : ''
  const steps = (t.checklistItems || []).filter((c) => !c.isChecked).map((c) => `- ${c.displayName}`)
  const notes = [body, steps.length ? `Steps still open in To Do:\n${steps.join('\n')}` : '', `Microsoft To Do list: ${listName}`].filter(Boolean).join('\n\n')
  return { title: (t.title || '').trim().slice(0, 500), notes, priority: t.importance === 'high' ? 1 : t.importance === 'low' ? 3 : 2,
    due_date: ymdOrNull(t.dueDateTime?.dateTime?.slice(0, 10)) }
}

/** Import every open task in the chosen lists. Tasks already imported are skipped, so running it again only brings new ones. */
export async function importTodo(listIds: string[]) {
  const lists = await todoLists()
  const chosen = lists.filter((l) => listIds.includes(l.id))
  if (!chosen.length) fail(400, 'Choose at least one To Do list.')
  const made: Row[] = []
  let skipped = 0
  for (const list of chosen) {
    let path: string | null = `/me/todo/lists/${encodeURIComponent(list.id)}/tasks`
    let query: Record<string, string> | undefined = { $filter: "status ne 'completed'", $expand: 'checklistItems', $top: '100' }
    while (path) {
      const page: { value: TodoTask[]; '@odata.nextLink'?: string } = await todoGraph(path, query)
      for (const t of page.value || []) {
        if (t.status === 'completed' || !(t.title || '').trim()) continue
        const saved = await saveImport({ source: 'microsoft_todo', ref: t.id, title: t.title, items: [todoItem(t, list.name)] })
        if (saved.duplicate) skipped++
        else made.push(...saved.tasks)
      }
      const next = page['@odata.nextLink']
      path = next ? next.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, '') : null
      query = undefined
    }
  }
  return { tasks: made, skipped, lists: chosen.map((l) => l.name) }
}

// ---------------------------------------------------------------- Fireflies

const FIREFLIES = 'https://api.fireflies.ai/graphql'

async function fireflies<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const key = env.firefliesKey()
  if (!key) fail(503, 'Fireflies is not connected. Add your Fireflies API key in Settings.')
  const r = await fetch(FIREFLIES, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }) })
  const out = (await r.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] }
  if (r.status === 401 || r.status === 403) fail(502, 'Fireflies refused the API key. Check it in Settings.')
  if (!r.ok || out.errors?.length || !out.data) fail(502, `Fireflies: ${out.errors?.[0]?.message || `HTTP ${r.status}`}`)
  return out.data!
}

type FFMeeting = { id: string; title: string; date: number | string; duration?: number; organizer_email?: string; participants?: string[]
  summary?: { action_items?: string | null; overview?: string | null } | null }

const ffDate = (d: number | string) => { const t = new Date(typeof d === 'number' ? d : Number(d) || d); return isNaN(t.getTime()) ? null : t.toISOString() }

export async function firefliesMeetings(limit = 15) {
  const data = await fireflies<{ transcripts: FFMeeting[] }>(
    `query Recent($limit: Int) { transcripts(limit: $limit) { id title date duration organizer_email summary { action_items } } }`, { limit })
  const ids = (data.transcripts || []).map((t) => t.id)
  const done = new Set((await q(`SELECT ref FROM imports WHERE source = 'fireflies' AND ref = ANY($1)`, [ids])).map((r) => r.ref))
  return (data.transcripts || []).map((t) => ({ id: t.id, title: t.title, date: ffDate(t.date), minutes: t.duration ? Math.round(t.duration) : null,
    organiser: t.organizer_email || null, has_actions: !!t.summary?.action_items?.trim(), imported: done.has(t.id) }))
}

export async function importFireflies(id: string, force = false) {
  const data = await fireflies<{ transcript: FFMeeting | null }>(
    `query One($id: String!) { transcript(id: $id) { id title date participants summary { action_items overview } } }`, { id })
  const t = data.transcript || fail(404, 'Fireflies has no meeting with that id.')
  const actions = t!.summary?.action_items?.trim()
  if (!actions) fail(422, 'Fireflies has no action items for that meeting yet. It may still be processing; try again shortly.')
  const when = ffDate(t!.date)
  const text = [`Meeting: ${t!.title}${when ? ` (${when.slice(0, 10)})` : ''}`, t!.participants?.length ? `Attendees: ${t!.participants.join(', ')}` : '',
    t!.summary?.overview ? `Overview:\n${t!.summary.overview}` : '', `Action items:\n${actions}`].filter(Boolean).join('\n\n')
  const items = await extractActions(text, 'meeting', t!.title)
  if (!items.length) fail(422, 'No actions were found in that meeting.')
  return saveImport({ source: 'fireflies', ref: t!.id, title: t!.title, items, force })
}
