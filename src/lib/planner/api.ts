/**
 * The work planner and projects, mounted under /api/todo: /planner for the week, /projects for projects and items to
 * come back to. Same access rules as every other endpoint.
 */
import { z } from 'zod'
import { one, q } from '../db'
import { body, fail } from '../http'
import { runLater, type Endpoint } from '../router'
import { addDays, isYmd, londonToday } from '../dates'
import { logEvent, processQueue, seedDefaults } from '../agents/orchestrator'
import { applyPlan, mondayOf, planOut, planWeek, plannerTask, weekView } from './plan'
import { dueBack, PROJECT_REVIEW_DAYS, projectOut, saveForLater, taskCounts } from './projects'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
const ProjectIn = z.object({ kind: z.enum(['project', 'item']).default('item'), title: z.string().trim().min(1).max(300), notes: z.string().max(10_000).default(''),
  outcome: z.string().max(2000).default(''), next_step: z.string().max(1000).default(''), link: z.string().max(1000).default(''),
  status: z.enum(['active', 'someday']).default('active'), review_on: ymd.nullable().optional() })
const ProjectPatch = z.object({ title: z.string().trim().min(1).max(300), notes: z.string().max(10_000), outcome: z.string().max(2000), next_step: z.string().max(1000),
  link: z.string().max(1000), status: z.enum(['active', 'someday', 'done', 'dropped']), review_on: ymd.nullable(), kind: z.enum(['project', 'item']) }).partial()
const Reviewed = z.object({ review_on: ymd.optional(), days: z.number().int().min(1).max(365).optional() })
const NewTask = z.object({ title: z.string().trim().min(1).max(500).optional(), notes: z.string().max(10_000).optional(), priority: z.number().int().min(1).max(3).default(2),
  due_date: ymd.nullable().optional(), run_now: z.boolean().default(true) })
const Week = z.object({ week: ymd.optional() })

const getProject = async (id: string) => (await one(`SELECT * FROM projects WHERE id::text = $1`, [id])) || fail(404, 'Not found.')
const kick = () => runLater(() => processQueue({ limit: 5 }))
const weekParam = (req: Request) => { const w = new URL(req.url).searchParams.get('week'); return mondayOf(w && isYmd(w) ? w : londonToday()) }

export const plannerEndpoints: Endpoint[] = [
  ['GET', '/planner', async (req) => weekView(weekParam(req))],
  ['POST', '/planner/plan', async (req) => {
    const b = await body(req, Week)
    return planWeek(mondayOf(b.week || londonToday()))
  }],
  ['POST', '/planner/plans/:id/apply', async (_r, p) => (await applyPlan(p.id)) || fail(404, 'That plan has been used or replaced. Make a new one.')],
  ['POST', '/planner/plans/:id/dismiss', async (_r, p) => {
    const r = await one(`UPDATE plans SET status = 'dismissed' WHERE id::text = $1 AND status = 'proposed' RETURNING *`, [p.id])
    return planOut(r || fail(404, 'Plan not found.'))
  }],

  ['GET', '/projects', async (req) => {
    const u = new URL(req.url)
    const kind = u.searchParams.get('kind')
    const all = u.searchParams.get('all') === 'true'
    const rows = await q(`SELECT * FROM projects WHERE ($1::text IS NULL OR kind = $1) AND ($2 OR status IN ('active', 'someday'))
      ORDER BY status = 'someday', review_on NULLS LAST, updated_at DESC LIMIT 500`, [kind === 'project' || kind === 'item' ? kind : null, all])
    const counts = await taskCounts(rows.filter((r) => r.kind === 'project').map((r) => r.id))
    return { projects: rows.map((r) => projectOut(r, r.kind === 'project' ? counts.get(String(r.id)) ?? { open: 0, done: 0 } : undefined)),
      due_back: (await dueBack()).map((r) => r.id) }
  }],
  ['POST', '/projects', async (req) => {
    const b = await body(req, ProjectIn)
    const r = await saveForLater({ ...b, kind: b.kind })
    const updated = (await one(`UPDATE projects SET outcome = $2, next_step = $3, status = $4 WHERE id = $1 RETURNING *`, [r.id, b.outcome, b.next_step, b.status]))!
    return Response.json(projectOut(updated, b.kind === 'project' ? { open: 0, done: 0 } : undefined), { status: 201 })
  }],
  ['GET', '/projects/:id', async (_r, p) => {
    const pr = await getProject(p.id)
    const tasks = await q(`SELECT t.*, NULL AS project_title FROM tasks t WHERE t.project_id = $1 ORDER BY t.status = 'done', t.planned_for NULLS LAST, t.due_date NULLS LAST, t.priority`, [pr!.id])
    return { project: projectOut(pr!, { open: tasks.filter((t) => t.status !== 'done').length, done: tasks.filter((t) => t.status === 'done').length }),
      tasks: tasks.map((t) => ({ ...plannerTask(t), summary: t.summary })) }
  }],
  ['PATCH', '/projects/:id', async (req, p) => {
    const b = await body(req, ProjectPatch)
    const pr = await getProject(p.id)
    const sets: string[] = []
    const vals: unknown[] = [pr!.id]
    for (const [k, v] of Object.entries(b)) { vals.push(v ?? null); sets.push(`${k} = $${vals.length}`) }
    if (!sets.length) return projectOut(pr!)
    return projectOut((await one(`UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, vals))!)
  }],
  ['DELETE', '/projects/:id', async (_r, p) => {
    const pr = await getProject(p.id)
    // Its tasks stay; they are no longer in a project.
    await q(`UPDATE tasks SET project_id = NULL WHERE project_id = $1`, [pr!.id])
    await q(`DELETE FROM projects WHERE id = $1`, [pr!.id])
  }],
  // Looked at: comes back again on the date given, in so many days, or in the usual time.
  ['POST', '/projects/:id/reviewed', async (req, p) => {
    const b = await body(req, Reviewed)
    const pr = await getProject(p.id)
    const next = b.review_on || addDays(londonToday(), b.days ?? (pr!.kind === 'project' ? PROJECT_REVIEW_DAYS : 30))
    return projectOut((await one(`UPDATE projects SET review_on = $2, reviewed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [pr!.id, next]))!)
  }],
  // A task from an item (the item is then done: it has become work) or a new task in a project.
  ['POST', '/projects/:id/task', async (req, p) => {
    const b = await body(req, NewTask)
    const pr = await getProject(p.id)
    await seedDefaults()
    const notes = b.notes ?? [pr!.notes, pr!.link && `Link: ${pr!.link}`].filter(Boolean).join('\n\n')
    const t = (await one(`INSERT INTO tasks (title, notes, priority, due_date, project_id, last_touched_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id, title`,
      [b.title || pr!.title, notes, b.priority, b.due_date ?? null, pr!.kind === 'project' ? pr!.id : null]))!
    if (pr!.kind === 'item') await q(`UPDATE projects SET status = 'done', updated_at = now() WHERE id = $1`, [pr!.id])
    if (b.run_now) kick()
    return Response.json({ task_id: t.id, title: t.title }, { status: 201 })
  }],
  // Hand the project to the agent team to plan its next steps.
  ['POST', '/projects/:id/plan', async (req, p) => {
    const pr = await getProject(p.id)
    if (pr!.kind !== 'project') fail(400, 'Make it a project first.')
    await seedDefaults()
    const open = await q(`SELECT title, status, due_date FROM tasks WHERE project_id = $1 AND status <> 'done' ORDER BY due_date NULLS LAST`, [pr!.id])
    const done = await q(`SELECT title FROM tasks WHERE project_id = $1 AND status = 'done' ORDER BY updated_at DESC LIMIT 20`, [pr!.id])
    const notes = [pr!.notes && `About the project:\n${pr!.notes}`, pr!.outcome && `What done looks like:\n${pr!.outcome}`, pr!.next_step && `Next step Tom noted:\n${pr!.next_step}`,
      open.length && `Open tasks:\n${open.map((t) => `- ${t.title} (${t.status}${t.due_date ? `, due ${t.due_date}` : ''})`).join('\n')}`,
      done.length && `Done so far:\n${done.map((t) => `- ${t.title}`).join('\n')}`,
      'Plan the next steps: a short plan to the outcome with owners and dates, and the next three concrete actions. Say what should be delegated.'].filter(Boolean).join('\n\n')
    const t = (await one(`INSERT INTO tasks (title, notes, priority, project_id, last_touched_at) VALUES ($1, $2, 2, $3, now()) RETURNING id`,
      [`Plan the next steps for ${pr!.title}`.slice(0, 500), notes, pr!.id]))!
    await logEvent(t.id, 'status', 'tom', { status: 'queued', reason: 'plan the project' })
    await q(`UPDATE projects SET reviewed_at = now(), review_on = $2, updated_at = now() WHERE id = $1`, [pr!.id, addDays(londonToday(), PROJECT_REVIEW_DAYS)])
    kick()
    return Response.json({ task_id: t.id }, { status: 201 })
  }],
]
