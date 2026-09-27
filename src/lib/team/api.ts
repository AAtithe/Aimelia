/**
 * Direct reports and 1-2-1 prep, mounted under /api/todo: /reports for the people, the list for each 1-2-1 (built from
 * tasks, projects, email and meetings, plus Tom's points) and the prep sheet. Same access rules as every other endpoint.
 */
import { z } from 'zod'
import { one, q } from '../db'
import { body, fail } from '../http'
import { type Endpoint } from '../router'
import { addPoint, dismissTask, getReport, markHeld, pointOut, POINT_KINDS, reportOut, reportView, seedReports, writePrep } from './oneToOnes'

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
const ReportIn = z.object({ name: z.string().trim().min(1).max(120), area: z.string().trim().max(120).default(''), email: z.string().trim().max(300).default(''),
  every_days: z.number().int().min(1).max(365).default(14), next_on: ymd.nullable().optional() })
const ReportPatch = z.object({ name: z.string().trim().min(1).max(120), area: z.string().trim().max(120), email: z.string().trim().max(300), notes: z.string().max(10_000),
  every_days: z.number().int().min(1).max(365), next_on: ymd.nullable(), active: z.boolean(), position: z.number().int().min(0).max(1000) }).partial()
const PointIn = z.object({ text: z.string().trim().max(2000).optional(), kind: z.enum(POINT_KINDS).optional(), task_id: z.string().uuid().nullable().optional() })
const PointPatch = z.object({ text: z.string().trim().min(1).max(2000), kind: z.enum(POINT_KINDS), status: z.enum(['open', 'discussed', 'dropped']) }).partial()
const Held = z.object({ carry_over: z.array(z.string().uuid()).max(200).default([]), held_on: ymd.optional(),
  next_on: ymd.nullable().optional() })
const Dismiss = z.object({ task_id: z.string().uuid() })

const getPoint = async (id: string) => (await one(`SELECT * FROM report_points WHERE id::text = $1`, [id])) || fail(404, 'Not found.')
const pointById = async (id: string) => pointOut((await one(`SELECT rp.*, t.title AS task_title, t.status AS task_status, t.due_date AS task_due
  FROM report_points rp LEFT JOIN tasks t ON t.id = rp.task_id WHERE rp.id = $1`, [id]))!)

export const reportEndpoints: Endpoint[] = [
  ['GET', '/reports', async (req) => {
    await seedReports()
    const u = new URL(req.url)
    const rows = await q(`SELECT * FROM reports WHERE ($1 OR active) ORDER BY active DESC, position, created_at`, [u.searchParams.get('all') === 'true'])
    // lite: just the people, for pickers.
    return { reports: u.searchParams.get('lite') === 'true' ? rows.map(reportOut) : await Promise.all(rows.map(reportView)) }
  }],
  ['POST', '/reports', async (req) => {
    await seedReports()
    const b = await body(req, ReportIn)
    const pos = (await one(`SELECT COALESCE(max(position) + 1, 0)::int AS n FROM reports`))!.n
    const r = (await one(`INSERT INTO reports (name, area, email, every_days, next_on, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [b.name, b.area, b.email, b.every_days, b.next_on ?? null, pos]))!
    return Response.json(await reportView(r), { status: 201 })
  }],
  ['GET', '/reports/:id', async (_r, p) => reportView(await getReport(p.id))],
  ['PATCH', '/reports/:id', async (req, p) => {
    const b = await body(req, ReportPatch)
    const r = await getReport(p.id)
    const sets: string[] = []
    const vals: unknown[] = [r!.id]
    for (const [k, v] of Object.entries(b)) { vals.push(v ?? null); sets.push(`${k} = $${vals.length}`) }
    if (!sets.length) return reportView(r!)
    return reportView((await one(`UPDATE reports SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, vals))!)
  }],
  ['DELETE', '/reports/:id', async (_r, p) => { const r = await getReport(p.id); await q(`DELETE FROM reports WHERE id = $1`, [r!.id]) }],

  ['POST', '/reports/:id/points', async (req, p) => {
    const b = await body(req, PointIn)
    const r = await getReport(p.id)
    const pt = await addPoint(r!.id, b)
    return Response.json(await pointById(pt.id), { status: 201 })
  }],
  ['POST', '/reports/:id/dismiss', async (req, p) => {
    const b = await body(req, Dismiss)
    const r = await getReport(p.id)
    await dismissTask(r!.id, b.task_id)
    return reportView(r!)
  }],
  ['POST', '/reports/:id/prep', async (_r, p) => reportView(await writePrep(await getReport(p.id)))],
  ['POST', '/reports/:id/held', async (req, p) => {
    const b = await body(req, Held)
    return reportView(await markHeld(await getReport(p.id), b))
  }],

  ['PATCH', '/report-points/:id', async (req, p) => {
    const b = await body(req, PointPatch)
    const pt = await getPoint(p.id)
    const sets: string[] = []
    const vals: unknown[] = [pt!.id]
    for (const [k, v] of Object.entries(b)) { vals.push(v); sets.push(`${k} = $${vals.length}`) }
    if (b.status) sets.push(b.status === 'open' ? 'discussed_at = NULL' : 'discussed_at = COALESCE(discussed_at, now())')
    if (sets.length) await q(`UPDATE report_points SET ${sets.join(', ')} WHERE id = $1`, vals)
    return pointById(pt!.id)
  }],
  ['DELETE', '/report-points/:id', async (_r, p) => { const pt = await getPoint(p.id); await q(`DELETE FROM report_points WHERE id = $1`, [pt!.id]) }],
]
