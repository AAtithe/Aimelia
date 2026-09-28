/**
 * Tasks worked in stages: go and ask someone, come back with the answer, then the next stage.
 *
 * A stage is an ask (a named person, and what to ask them) or a do (a piece of work). They run in order; the
 * current stage is the first one still open. Tom goes to each person himself; the team drafts the message for an
 * ask and does the work for a do, using every answer so far. Recording an answer (or marking a do stage done)
 * moves the task on: the team picks it up again for the next stage. A task is not done while a stage is open.
 */
import { one, q, type Row } from '../db'
import { logEvent } from './orchestrator'

export type StageKind = 'ask' | 'do'
export type StageIn = { kind: StageKind; who: string; title: string; details: string }

export const MAX_STAGES = 12

export const STAGE_GUIDANCE = 'The task runs in stages, in order, and Tom goes to each person himself. Work the current stage only. ' +
  'For an ask, produce one action: the message Tom sends to that person to ask it (kind email_draft with details.to when you know their ' +
  'address, otherwise a note Tom can paste into Teams), short and specific, saying what is needed and by when. For a do stage, produce the ' +
  'finished work for it using every answer so far. Never do later stages early and never re-ask what an earlier stage has answered. ' +
  'When no stage is left, finish the task using the answers, or if nothing more is needed, one note saying what was settled.'

/** Stages as the model gave them: kept only with a title, an ask needs someone to ask. */
export function cleanStages(raw: unknown): StageIn[] {
  if (!Array.isArray(raw)) return []
  const out: StageIn[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const x = s as any
    const title = String(x.title || x.question || '').trim()
    if (!title) continue
    const who = String(x.who || x.person || '').trim().slice(0, 120)
    const kind: StageKind = String(x.kind || '').toLowerCase() === 'do' || !who ? 'do' : 'ask'
    out.push({ kind, who: kind === 'ask' ? who : '', title: title.slice(0, 500), details: String(x.details || x.why || '').slice(0, 2000) })
  }
  return out.slice(0, MAX_STAGES)
}

export async function stagesOf(taskId: string): Promise<Row[]> {
  return q(`SELECT * FROM task_stages WHERE task_id = $1 ORDER BY position, created_at`, [taskId])
}

/** The stage the task is on: the first one still open. */
export async function currentStage(taskId: string): Promise<Row | null> {
  return one(`SELECT * FROM task_stages WHERE task_id = $1 AND status = 'open' ORDER BY position, created_at LIMIT 1`, [taskId])
}

export async function hasOpenStage(taskId: string): Promise<boolean> {
  return !!(await currentStage(taskId))
}

/** Adds stages after any already there. Returns the rows made. */
export async function addStages(taskId: string, stages: StageIn[], by: string): Promise<Row[]> {
  const have = (await one<{ n: number; last: number }>(`SELECT count(*)::int AS n, COALESCE(MAX(position), -1)::int AS last FROM task_stages WHERE task_id = $1`, [taskId]))!
  const room = Math.max(MAX_STAGES - have.n, 0)
  const made: Row[] = []
  for (const [i, s] of stages.slice(0, room).entries()) {
    made.push((await one(`INSERT INTO task_stages (task_id, position, kind, who, title, details, added_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [taskId, have.last + 1 + i, s.kind, s.who, s.title, s.details, by]))!)
  }
  if (made.length) await logEvent(taskId, 'stages', by, { added: made.map(stageLine) })
  return made
}

export const stageLine = (s: Row) => s.kind === 'ask' ? `Ask ${s.who}: ${s.title}` : s.title

export function stageOut(s: Row) {
  return { id: s.id, task_id: s.task_id, position: s.position, kind: s.kind, who: s.who, title: s.title, details: s.details, status: s.status,
    answer: s.answer ?? null, added_by: s.added_by, done_at: s.done_at ? new Date(s.done_at).toISOString() : null }
}

/** What the agents see of a staged task: every stage with its answer, which one they are on, and how to work it. */
export async function stagesForContext(taskId: string) {
  const rows = await stagesOf(taskId)
  if (!rows.length) return null
  const current = rows.find((s) => s.status === 'open')
  const view = (s: Row, i: number) => ({ number: i + 1, kind: s.kind, ...(s.kind === 'ask' ? { ask: s.who } : {}), title: s.title,
    ...(s.details ? { details: s.details } : {}), status: s.status, ...(s.answer ? { [s.kind === 'ask' ? 'answer' : 'outcome']: s.answer } : {}) })
  return {
    task_stages: rows.map(view),
    current_stage: current ? view(current, rows.indexOf(current)) : 'none left: finish the task',
    how_to_work_in_stages: STAGE_GUIDANCE,
  }
}

/**
 * Settles a stage: answered (an ask), done (a do, with an optional outcome) or skipped. The drafts made for it
 * go with it: any not yet approved are set aside, any approved but not carried out are marked done, and a check
 * waiting only on its messages is closed, since the answer is in. Returns the stage, or null if it was not open.
 */
export async function settleStage(stageId: string, outcome: 'answered' | 'done' | 'skipped', text: string, actor = 'tom'): Promise<Row | null> {
  const status = outcome === 'skipped' ? 'skipped' : 'done'
  const s = await one(`UPDATE task_stages SET status = $2, answer = NULLIF($3, ''), done_at = now() WHERE id::text = $1 AND status = 'open' RETURNING *`,
    [stageId, status, outcome === 'skipped' ? '' : text.trim()])
  if (!s) return null
  await q(`UPDATE actions SET status = 'superseded' WHERE task_id = $1 AND status = 'proposed' AND details->>'stage_id' = $2`, [s.task_id, s.id])
  await q(`UPDATE actions SET status = 'done', done_at = now() WHERE task_id = $1 AND status = 'approved' AND details->>'stage_id' = $2`, [s.task_id, s.id])
  const checks = await q(`UPDATE tasks f SET status = 'done', updated_at = now() WHERE f.kind = 'follow_up' AND f.parent_id = $1 AND f.status IN ('scheduled','due')
      AND jsonb_array_length(COALESCE(f.follow_up->'items', '[]'::jsonb)) > 0
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f.follow_up->'items') i
        WHERE NOT EXISTS (SELECT 1 FROM actions a WHERE a.id::text = i->>'action_id' AND a.details->>'stage_id' = $2))
      RETURNING f.id`, [s.task_id, s.id])
  for (const c of checks) await logEvent(c.id, 'status', actor, { status: 'done', reason: `the answer came back: ${stageLine(s)}` })
  await logEvent(s.task_id, 'stage', actor, { stage: stageLine(s), kind: s.kind, who: s.who, outcome, ...(text.trim() && outcome !== 'skipped' ? { answer: text.trim() } : {}) })
  return s
}

/** Marks each draft made while a stage is current as belonging to it, so it goes with the stage when it is settled. */
export function tagForStage<T extends { details: Record<string, unknown> }>(drafts: T[], stage: Row | null): T[] {
  if (!stage) return drafts
  return drafts.map((d) => ({ ...d, details: { ...d.details, stage_id: stage.id } }))
}

export async function briefingStages(orderBy: string): Promise<Row[]> {
  return q(`SELECT s.*, t.title AS task_title, t.priority AS task_priority, t.status AS task_status,
      (SELECT count(*)::int FROM task_stages c WHERE c.task_id = s.task_id) AS stage_count,
      (SELECT count(*)::int FROM task_stages c WHERE c.task_id = s.task_id AND (c.position, c.created_at) < (s.position, s.created_at)) + 1 AS stage_number,
      COALESCE((SELECT json_agg(json_build_object('kind', c.kind, 'who', c.who, 'title', c.title, 'answer', c.answer, 'status', c.status) ORDER BY c.position, c.created_at)
        FROM task_stages c WHERE c.task_id = s.task_id AND c.status <> 'open'), '[]'::json) AS earlier
    FROM task_stages s JOIN tasks t ON t.id = s.task_id
    WHERE s.status = 'open' AND t.status NOT IN ('done', 'scheduled')
      AND NOT EXISTS (SELECT 1 FROM task_stages e WHERE e.task_id = s.task_id AND e.status = 'open' AND (e.position, e.created_at) < (s.position, s.created_at))
    ORDER BY ${orderBy}, s.created_at`)
}

export const briefingStageOut = (s: Row) => ({ ...stageOut(s), task_title: s.task_title, task_priority: s.task_priority, task_status: s.task_status,
  stage_number: s.stage_number, stage_count: s.stage_count, earlier: s.earlier ?? [] })
