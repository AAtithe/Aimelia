import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { chatEndpoints } from '@/lib/chat/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { buildBrief } from '@/lib/agents/notify'
import { mondayOf, plainPlan } from '@/lib/planner/plan'
import { addDays, londonToday } from '@/lib/dates'
import { encrypt } from '@/lib/crypto'
import { one, q } from '@/lib/db'
import { call } from './helpers'

const todo = dispatcher('/api/todo', todoEndpoints)
const chat = dispatcher('/api/chat', chatEndpoints)
const req = (method: string, path: string, b?: unknown) => call(todo as any, { method, path: `/api/todo${path}`, body: b })

// Next week, so every day is still to come whatever day the tests run.
const MON = mondayOf(addDays(londonToday(), 7))
const [TUE, WED, THU, FRI] = [1, 2, 3, 4].map((n) => addDays(MON, n))

let replies: Record<string, unknown[]> = {}
const calls: ModelCall[] = []
type Hit = { method: string; url: URL; body: any }
let hits: Hit[] = []
let routes: [RegExp, string, (h: Hit) => unknown][] = []
beforeEach(() => {
  setLaterHook(() => {})
  replies = {}; calls.length = 0; hits = []; routes = []
  setModelTransport(async (c) => {
    calls.push(c)
    const list = replies[c.role] || []
    const next = list.length > 1 ? list.shift() : list[0]
    if (next instanceof Error) throw next
    return typeof next === 'string' ? next : JSON.stringify(next ?? {})
  })
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
    const url = new URL(input)
    const h = { method: init.method || 'GET', url, body: init.body ? JSON.parse(init.body) : null }
    hits.push(h)
    for (const [re, m, fn] of routes) if (m === h.method && re.test(url.pathname)) return Response.json(fn(h) ?? {})
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { setModelTransport(null); setLaterHook(null) })
const on = (method: string, re: RegExp, fn: (h: Hit) => unknown) => routes.push([re, method, fn])
const connect = () => q(`INSERT INTO ms_tokens (owner, account, access_token, refresh_token, expires_at) VALUES ('owner', 'owner@example.co', $1, $2, now() + interval '1 hour')`,
  [encrypt('graph-token'), encrypt('refresh')])

async function task(title: string, extra: Record<string, unknown> = {}) {
  const t = (await req('POST', '/tasks', { title, run_now: false, ...extra })).data
  const { planned_for, estimate_minutes, project_id, ...rest } = extra as any
  if (planned_for !== undefined || estimate_minutes !== undefined || project_id !== undefined) await req('PATCH', `/tasks/${t.id}`, { planned_for, estimate_minutes, project_id })
  void rest
  return t
}
const week = async () => (await req('GET', `/planner?week=${WED}`)).data // any day in the week gives its Monday

describe('the week', () => {
  it('shows each day: free time, what is planned, what is due and what comes back', async () => {
    await task('Bentleys board pack', { planned_for: TUE, estimate_minutes: 240, priority: 1 })
    await task('Corrigans tronc sign-off', { planned_for: TUE, estimate_minutes: 300 })
    await task('Soho pricing', { due_date: THU })
    await task('Unplanned idea')
    const parked = await task('Parked one')
    await q(`UPDATE tasks SET status = 'scheduled', scheduled_for = $2 WHERE id = $1`, [parked.id, WED])
    await req('POST', '/projects', { kind: 'item', title: 'Second practice in the South West', review_on: FRI })
    const w = await week()
    expect(w.week).toBe(MON)
    expect(w.calendar).toBe(false)
    expect(w.days.map((d: any) => d.date)).toEqual([MON, TUE, WED, THU, FRI])
    const tue = w.days[1]
    expect(tue.free_minutes).toBe(510) // 09:00 to 17:30 with no calendar
    expect([tue.planned_minutes, tue.over_by]).toEqual([540, 30])
    expect(tue.planned.map((t: any) => t.title)).toEqual(['Bentleys board pack', 'Corrigans tronc sign-off'])
    expect(w.days[3].due.map((t: any) => t.title)).toEqual(['Soho pricing'])
    expect(w.days[2].coming_back).toEqual([{ kind: 'task', id: parked.id, title: 'Parked one' }])
    expect(w.days[4].coming_back[0]).toMatchObject({ kind: 'item', title: 'Second practice in the South West' })
    expect(w.to_plan.map((t: any) => t.title).sort()).toEqual(['Soho pricing', 'Unplanned idea'])
  })

  it('takes meetings off from Outlook busy times, merged and within working hours, never reading their details', async () => {
    await connect()
    on('GET', /\/me\/calendarView$/, () => ({ value: [
      { start: { dateTime: `${TUE}T10:00:00.0000000` }, end: { dateTime: `${TUE}T11:00:00.0000000` }, showAs: 'busy' },
      { start: { dateTime: `${TUE}T10:30:00.0000000` }, end: { dateTime: `${TUE}T12:00:00.0000000` }, showAs: 'busy' }, // overlaps: 2h in all
      { start: { dateTime: `${TUE}T08:00:00.0000000` }, end: { dateTime: `${TUE}T09:30:00.0000000` }, showAs: 'busy' }, // 30m inside the day
      { start: { dateTime: `${TUE}T14:00:00.0000000` }, end: { dateTime: `${TUE}T15:00:00.0000000` }, showAs: 'free' },
      { start: { dateTime: `${WED}T13:00:00.0000000` }, end: { dateTime: `${WED}T14:00:00.0000000` }, showAs: 'busy', isCancelled: true },
    ] }))
    const w = await week()
    expect(w.calendar).toBe(true)
    expect([w.days[1].busy_minutes, w.days[1].meetings, w.days[1].free_minutes]).toEqual([150, 3, 360])
    expect(w.days[2].busy_minutes).toBe(0)
    expect(hits[0].url.searchParams.get('$select')).toBe('start,end,showAs,isCancelled')
  })
})

describe('plan my week', () => {
  it('without an AI: deadlines first, within four fifths of free time, and says what does not fit', () => {
    const room = new Map([[MON, 120], [TUE, 120]])
    const p = plainPlan([
      { id: 'a', title: 'Low, no date', priority: 3, due_date: null, estimate_minutes: 60 },
      { id: 'b', title: 'Due Tuesday', priority: 2, due_date: TUE, estimate_minutes: 90 },
      { id: 'c', title: 'High', priority: 1, due_date: null, estimate_minutes: null },
      { id: 'd', title: 'Due Monday, too big', priority: 1, due_date: MON, estimate_minutes: 200 },
    ] as any, room, [MON, TUE])
    // Monday is taken (over) by the big task due that day, so the Tuesday task goes on Tuesday and nothing else fits.
    expect(p.plan.map((x) => [x.task_id, x.day])).toEqual([['d', MON], ['b', TUE]])
    expect(p.not_this_week.map((x) => x.task_id)).toEqual(['c', 'a'])
    expect(p.warnings[0]).toContain('Due Monday, too big')
  })

  it('proposes, changes nothing until Tom uses it, then plans each task', async () => {
    const a = await task('Bentleys board pack', { due_date: TUE, priority: 1 })
    const b = await task('Soho pricing', { estimate_minutes: 90 })
    setModelTransport(async () => { throw new Error('no key') }) // the plain plan
    const p = (await req('POST', '/planner/plan', { week: WED })).data
    expect(p).toMatchObject({ by: 'plain', status: 'proposed', week: MON })
    expect(p.plan.map((x: any) => [x.title, x.day, x.minutes])).toEqual([['Bentleys board pack', MON, 60], ['Soho pricing', MON, 90]])
    expect((await one(`SELECT planned_for FROM tasks WHERE id = $1`, [a.id]))!.planned_for).toBeNull()
    expect((await week()).latest_plan.id).toBe(p.id)
    expect((await req('POST', `/planner/plans/${p.id}/apply`)).data).toEqual({ planned: 2 })
    const got = await one(`SELECT planned_for, estimate_minutes FROM tasks WHERE id = $1`, [a.id])
    expect([got!.planned_for, got!.estimate_minutes]).toEqual([MON, 60])
    expect((await one(`SELECT estimate_minutes FROM tasks WHERE id = $1`, [b.id]))!.estimate_minutes).toBe(90) // kept
    expect((await req('POST', `/planner/plans/${p.id}/apply`)).status).toBe(404)
    expect((await week()).latest_plan).toBeNull()
  })

  it('with Claude: gives each day its minutes to plan, and keeps only sound entries', async () => {
    const a = await task('Bentleys board pack', { due_date: TUE })
    const b = await task('Soho pricing')
    replies.planner = [{ summary: 'A tight week; Soho waits.', warnings: ['Tuesday is full'],
      plan: [{ task_id: a.id, day: TUE, minutes: 9999, why: 'due Tuesday' }, { task_id: 'made-up', day: WED, minutes: 60 }, { task_id: b.id, day: '2020-01-01', minutes: 30 }],
      not_this_week: [{ task_id: b.id, why: 'no room' }] }]
    const p = (await req('POST', '/planner/plan', { week: MON })).data
    const seen = JSON.parse(calls.find((c) => c.role === 'planner')!.messages[0].content)
    expect(seen.days).toEqual([MON, TUE, WED, THU, FRI].map((day) => ({ day, minutes_to_plan: 408 }))) // 510 less a fifth
    expect(p.by).toBe('ai')
    expect(p.plan).toEqual([{ task_id: a.id, title: 'Bentleys board pack', day: TUE, minutes: 480, why: 'due Tuesday' }])
    expect(p.not_this_week).toEqual([{ task_id: b.id, title: 'Soho pricing', why: 'no room' }])
    expect(p.warnings).toEqual(['Tuesday is full'])
    const again = (await req('POST', '/planner/plan', { week: MON })).data
    expect((await one(`SELECT status FROM plans WHERE id = $1`, [p.id]))!.status).toBe('replaced')
    expect(again.id).not.toBe(p.id)
  })

  it('books focus time on the planned day, or says the day is full', async () => {
    await connect()
    const t = await task('Bentleys board pack', { planned_for: TUE, estimate_minutes: 120 })
    let full = false
    on('GET', /\/me\/calendarView$/, () => ({ value: full ? [{ start: { dateTime: `${TUE}T09:00:00` }, end: { dateTime: `${TUE}T17:30:00` }, showAs: 'busy' }] : [] }))
    on('POST', /\/me\/events$/, (h) => ({ id: 'ev1', webLink: 'https://outlook/ev1', ...h.body }))
    const r = await req('POST', `/tasks/${t.id}/book`, { on: TUE })
    expect(r.data.event.start).toBe(`${TUE}T09:00`)
    expect(hits.find((h) => h.method === 'POST')!.body.end.dateTime).toBe(`${TUE}T11:00:00`) // its estimate
    full = true
    const t2 = await task('Corrigans', { planned_for: TUE })
    const r2 = await req('POST', `/tasks/${t2.id}/book`, { on: TUE })
    expect(r2.status).toBe(409)
    expect(r2.data.detail).toContain(TUE)
  })
})

describe('projects and items to come back to', () => {
  it('an item comes back in a month, a project in a fortnight, unless a date is set', async () => {
    const item = (await req('POST', '/projects', { title: 'Look at the second practice' })).data
    const project = (await req('POST', '/projects', { kind: 'project', title: 'Payroll bureau launch', outcome: 'Ten clients live by March' })).data
    expect([item.kind, item.review_on]).toEqual(['item', addDays(londonToday(), 30)])
    expect([project.kind, project.review_on, project.open_tasks]).toEqual(['project', addDays(londonToday(), 14), 0])
  })

  it('what is due back shows on Today, in the morning push and in the sidebar count, and can be pushed back', async () => {
    const item = (await req('POST', '/projects', { title: 'Call Priya about the Soho group', review_on: londonToday() })).data
    await req('POST', '/projects', { title: 'Not yet', review_on: addDays(londonToday(), 3) })
    const b = (await req('GET', '/briefing')).data
    expect(b.due_back.map((x: any) => x.title)).toEqual(['Call Priya about the Soho group'])
    const brief = await buildBrief()
    expect(brief.headline).toContain('1 back on your desk')
    expect(brief.lines).toContain('Back to look at: Call Priya about the Soho group')
    const pushed = (await req('POST', `/projects/${item.id}/reviewed`, { days: 7 })).data
    expect(pushed.review_on).toBe(addDays(londonToday(), 7))
    expect((await req('GET', '/briefing')).data.due_back).toEqual([])
  })

  it('an item made into a task is done; the task carries its notes and link', async () => {
    const item = (await req('POST', '/projects', { title: 'Second practice', notes: 'Owner retiring in 2027', link: 'https://example.co/listing' })).data
    const r = await req('POST', `/projects/${item.id}/task`, { run_now: false })
    const t = (await req('GET', `/tasks/${r.data.task_id}`)).data
    expect(t.title).toBe('Second practice')
    expect(t.notes).toContain('Owner retiring in 2027')
    expect(t.notes).toContain('https://example.co/listing')
    expect(t.project_id).toBeNull()
    expect((await req('GET', '/projects')).data.projects).toHaveLength(0) // done, so off the active list
  })

  it('a project holds its tasks, shows progress, and can be handed to the team to plan', async () => {
    const p = (await req('POST', '/projects', { kind: 'project', title: 'Payroll bureau launch', outcome: 'Ten clients live by March', next_step: 'Price it' })).data
    await req('POST', `/projects/${p.id}/task`, { title: 'Draft the price list', run_now: false })
    const other = await task('Existing task')
    await req('PATCH', `/tasks/${other.id}`, { project_id: p.id, status: 'done' })
    expect((await req('PATCH', `/tasks/${other.id}`, { project_id: '00000000-0000-0000-0000-000000000000' })).status).toBe(404)
    const d = (await req('GET', `/projects/${p.id}`)).data
    expect([d.project.open_tasks, d.project.done_tasks]).toEqual([1, 1])
    expect(d.tasks.map((t: any) => t.title)).toEqual(['Draft the price list', 'Existing task'])
    const r = await req('POST', `/projects/${p.id}/plan`)
    const plan = (await req('GET', `/tasks/${r.data.task_id}`)).data
    expect(plan.title).toBe('Plan the next steps for Payroll bureau launch')
    expect(plan.project_id).toBe(p.id)
    expect(plan.notes).toContain('Ten clients live by March')
    expect(plan.notes).toContain('- Draft the price list')
    expect(plan.notes).toContain('Done so far:\n- Existing task')
    // Deleting the project keeps its tasks.
    await req('DELETE', `/projects/${p.id}`)
    expect((await one(`SELECT project_id FROM tasks WHERE id = $1`, [other.id]))!.project_id).toBeNull()
  })

  it('Ask Aimelia can keep something for later', async () => {
    replies.chat = [{ tool_calls: [{ tool: 'save_for_later', args: { title: 'Soho group', notes: 'Six sites, revisit after Christmas', review_on: '2027-01-11' } }] }, { reply: 'Kept.' }]
    await call(chat as any, { method: 'POST', path: '/api/chat/chats', body: { message: 'Remind me to come back to the Soho group in January' } })
    const [p] = (await req('GET', '/projects')).data.projects
    expect(p).toMatchObject({ kind: 'item', title: 'Soho group', review_on: '2027-01-11', notes: 'Six sites, revisit after Christmas' })
  })
})
