import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { processQueue } from '@/lib/agents/orchestrator'
import { encrypt } from '@/lib/crypto'
import { q } from '@/lib/db'
import { call } from './helpers'

const api = dispatcher('/api/todo', todoEndpoints)
const req = (method: string, path: string, b?: unknown) => call(api as any, { method, path: `/api/todo${path}`, body: b })

const flights = { kind: 'decision', title: 'Fly out Tuesday 14 October', content: 'BA 117, 08:25 from Heathrow T5, back Friday on BA 178.', details: {} }

/** Workers reply from what they are shown; the first run decides when to fly, a rolled-on run books it. */
function script() {
  const calls: any[] = []
  setModelTransport(async (c: ModelCall) => {
    calls.push(c)
    if (c.role === 'reviewer') return JSON.stringify({ verdict: 'approve', score: 9, feedback: '', action_feedback: [], questions: [] })
    if (c.role !== 'worker' || (c.payload as any).you_are !== 'Planner') return JSON.stringify({ summary: 'kept', actions: null })
    const p = c.payload as any
    if (p.current_stage?.kind === 'do') return JSON.stringify({ summary: 'booking', actions: [{ kind: 'checklist', title: 'Book the flights', content: '- Book BA 117\n- Book BA 178', details: {} }] })
    return JSON.stringify({ summary: 'decided', actions: [flights] })
  })
  return calls
}

async function decided() {
  const t = (await req('POST', '/tasks', { title: 'Work out when to fly to New York', notes: 'Client meeting on the 15th', run_now: false })).data
  await processQueue()
  const a = (await req('GET', `/tasks/${t.id}`)).data.actions[0]
  expect(a.title).toBe('Fly out Tuesday 14 October')
  return { t, a }
}
const get = async (id: string) => (await req('GET', `/tasks/${id}`)).data

beforeEach(() => { setLaterHook(() => {}) })
afterEach(() => { setModelTransport(null); setLaterHook(null) })

describe('what comes next after approving', () => {
  it('rolls a settled decision on: the team works the next step on the same task with the decision in front of it', async () => {
    const calls = script()
    const { t, a } = await decided()
    expect((await req('POST', `/actions/${a.id}/next`, { roll_on: 'Book the flights' })).status).toBe(409) // approve it first
    const ok = await req('POST', `/actions/${a.id}/approve`, {})
    expect(ok.data.task_status).toBe('done')

    const r = await req('POST', `/actions/${a.id}/next`, { roll_on: 'Book those flights and put them in my diary' })
    expect(r.status).toBe(201)
    expect(r.data.task.status).toBe('queued')
    expect(r.data.task.stages).toHaveLength(1)
    expect(r.data.task.stages[0]).toMatchObject({ kind: 'do', title: 'Book those flights and put them in my diary', status: 'open' })
    expect(r.data.task.stages[0].details).toContain('BA 117, 08:25 from Heathrow T5')

    calls.length = 0
    await processQueue()
    const planner = calls.find((c) => c.payload?.you_are === 'Planner')
    expect(planner.payload.current_stage.title).toBe('Book those flights and put them in my diary')
    expect(planner.payload.current_stage.details).toContain('Fly out Tuesday 14 October')
    const got = await get(t.id)
    expect(got.status).toBe('ready')
    expect(got.actions.find((x: any) => x.status === 'proposed').title).toBe('Book the flights')
  })

  it('adds follow-on tasks that carry what was approved, and marks the approved item done', async () => {
    script()
    const { t, a } = await decided()
    await q(`UPDATE actions SET kind = 'document' WHERE id = $1`, [a.id]) // a to do item this time
    await req('PATCH', `/tasks/${t.id}`, { priority: 1 })
    await req('POST', `/actions/${a.id}/approve`, {})
    expect((await get(t.id)).status).toBe('doing')
    expect((await req('POST', `/actions/${a.id}/next`, {})).status).toBe(422)

    const r = await req('POST', `/actions/${a.id}/next`, { tasks: [{ title: 'Arrange airport transfers' }, { title: 'Tell Mandy I am away', due_date: '2026-10-10' }] })
    expect(r.status).toBe(201)
    expect(r.data.created.map((x: any) => x.title)).toEqual(['Arrange airport transfers', 'Tell Mandy I am away'])
    expect(r.data.created[1]).toMatchObject({ parent_id: t.id, priority: 1, due_date: '2026-10-10', source: 'next', status: 'queued' })
    const child = await get(r.data.created[0].id)
    expect(child.notes).toContain('Follows on from "Work out when to fly to New York"')
    expect(child.notes).toContain('BA 117')
    // The document was marked done, so the original task closes; the new ones are queued for the team.
    expect(r.data.task.status).toBe('done')
    expect(r.data.task.events.some((e: any) => e.kind === 'next' && e.content.tasks.length === 2)).toBe(true)
  })

  it('leaves the item in To do when Tom says not done yet', async () => {
    script()
    const { t, a } = await decided()
    await q(`UPDATE actions SET kind = 'checklist' WHERE id = $1`, [a.id])
    await req('POST', `/actions/${a.id}/approve`, {})
    const r = await req('POST', `/actions/${a.id}/next`, { tasks: [{ title: 'Pack' }], done: false })
    expect(r.data.task.status).toBe('doing')
    expect((await req('GET', '/briefing')).data.to_do.map((x: any) => x.id)).toEqual([a.id])
    expect((await get(t.id)).actions[0].status).toBe('approved')
  })

  it('puts it in the Outlook diary as Tom\'s appointment', async () => {
    script()
    const { t, a } = await decided()
    const sent: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
      sent.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers })
      return Response.json({ id: 'evt1', webLink: 'https://outlook.example/evt1' })
    }))
    expect((await req('POST', `/actions/${a.id}/diary`, { subject: 'Flight BA 117', date: '2026-10-14' })).status).toBe(422)
    expect((await req('POST', `/actions/${a.id}/diary`, { subject: 'Flight BA 117', date: '2026-10-14', start: '08:25', end: '07:00' })).status).toBe(422)
    // Not connected to Microsoft 365: refused plainly, and the screen offers a calendar file instead.
    expect((await req('POST', `/actions/${a.id}/diary`, { subject: 'Flight BA 117', date: '2026-10-14', start: '08:25' })).status).toBe(401)

    await q(`INSERT INTO ms_tokens (owner, account, access_token, refresh_token, expires_at) VALUES ('owner', 'owner@example.co', $1, $2, now() + interval '1 hour')`,
      [encrypt('graph-token'), encrypt('refresh')])
    const r = await req('POST', `/actions/${a.id}/diary`, { subject: 'Flight BA 117', date: '2026-10-14', start: '08:25', location: 'Heathrow T5' })
    expect(r.status).toBe(201)
    expect(r.data.event).toMatchObject({ id: 'evt1', start: '2026-10-14T08:25', end: '2026-10-14T09:25' })
    const ev = sent.find((s) => s.url.endsWith('/me/events'))
    expect(ev.method).toBe('POST')
    expect(ev.body).toMatchObject({ subject: 'Flight BA 117', isAllDay: false, location: { displayName: 'Heathrow T5' }, categories: ['Aimelia'],
      start: { dateTime: '2026-10-14T08:25:00', timeZone: 'Europe/London' } })
    expect(ev.body.body.content).toContain('BA 117, 08:25 from Heathrow T5')

    const day = await req('POST', `/actions/${a.id}/diary`, { subject: 'In New York', date: '2026-10-15', all_day: true })
    expect(day.data.event).toMatchObject({ start: '2026-10-15T00:00', end: '2026-10-16T00:00' })
    expect(sent.filter((s) => s.url.endsWith('/me/events')).at(-1).body).toMatchObject({ isAllDay: true, showAs: 'free' })
    expect((await get(t.id)).events.filter((e: any) => e.content.status === 'in the diary')).toHaveLength(2)
  })
})
