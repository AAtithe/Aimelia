import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { chatEndpoints } from '@/lib/chat/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { addDays, londonToday } from '@/lib/dates'
import { one, q } from '@/lib/db'
import { call } from './helpers'

const todo = dispatcher('/api/todo', todoEndpoints)
const chat = dispatcher('/api/chat', chatEndpoints)
const req = (method: string, path: string, b?: unknown) => call(todo as any, { method, path: `/api/todo${path}`, body: b })

let replies: Record<string, unknown[]> = {}
const calls: ModelCall[] = []
beforeEach(() => {
  setLaterHook(() => {})
  replies = {}; calls.length = 0
  setModelTransport(async (c) => {
    calls.push(c)
    const list = replies[c.role] || []
    const next = list.length > 1 ? list.shift() : list[0]
    return typeof next === 'string' ? next : JSON.stringify(next ?? {})
  })
})
afterEach(() => { setModelTransport(null); setLaterHook(null) })

const reports = async () => (await req('GET', '/reports')).data.reports
const byName = async (name: string) => (await reports()).find((r: any) => r.name === name)
const task = async (title: string, notes = '') => (await req('POST', '/tasks', { title, notes, run_now: false })).data

describe('1-2-1 prep', () => {
  it('starts with the five direct reports, once', async () => {
    const r = await reports()
    expect(r.map((x: any) => `${x.name}, ${x.area}`)).toEqual(['James, Commercial', 'Danielle, Enablement', 'Natasha, Operations', 'David G, Development', 'Sandeep, Finance'])
    // Removed people are not seeded back.
    await req('DELETE', `/reports/${r[4].id}`)
    expect((await reports()).length).toBe(4)
    await req('POST', '/reports', { name: 'Priya', area: 'People' })
    expect((await reports()).map((x: any) => x.name)).toEqual(['James', 'Danielle', 'Natasha', 'David G', 'Priya'])
  })

  it('builds the list from tasks, projects, email and meetings without being asked', async () => {
    const james = await byName('James')
    await req('POST', `/reports/${james.id}/points`, { text: 'Pipeline for Q4: three new groups signed' })
    const pricing = await task('Chase James on the Soho pricing proposal')
    const imported = await task('Send the Corrigans renewal', 'Owner named: James')
    const other = await task('Board pack', 'Natasha to send the ops numbers')
    await task('Jameson whisky order') // not a whole-word match
    const won = await task('James to sign Daffodil Mulligans')
    await req('PATCH', `/tasks/${won.id}`, { status: 'done' })
    await q(`UPDATE tasks SET due_date = $2 WHERE id = $1`, [pricing.id, addDays(londonToday(), -2)])
    await req('POST', '/projects', { kind: 'project', title: 'Payroll bureau launch', next_step: 'James to price it' })
    await req('PATCH', `/reports/${james.id}`, { email: 'James@williamsstanley.co' })
    await q(`INSERT INTO emails (graph_id, from_email, subject, received_at, action_required) VALUES ('m1', 'james@williamsstanley.co', 'Soho proposal', now(), 'Approve the discount')`)
    await q(`INSERT INTO meetings (graph_event_id, subject, start_at, attendees) VALUES ('e1', 'Pipeline review', now() - interval '1 day', '["james@williamsstanley.co"]')`)

    let j = await byName('James')
    expect(j.points.map((p: any) => [p.kind, p.text])).toEqual([['focus', 'Pipeline for Q4: three new groups signed']])
    expect(j.from_tasks.map((t: any) => [t.title, t.flag])).toEqual([['Chase James on the Soho pricing proposal', 'overdue'], ['Send the Corrigans renewal', null]])
    expect(j.delivered.map((t: any) => t.title)).toEqual(['James to sign Daffodil Mulligans'])
    expect(j.projects.map((p: any) => p.title)).toEqual(['Payroll bureau launch'])
    expect(j.emails).toEqual([expect.objectContaining({ subject: 'Soho proposal', action: 'Approve the discount' })])
    expect(j.meetings.map((m: any) => m.subject)).toEqual(['Pipeline review'])
    expect(j.agenda).toContain('Recognise\n- James to sign Daffodil Mulligans')
    expect(j.agenda).toContain('Chase James on the Soho pricing proposal (queued, due')
    expect((await byName('Natasha')).from_tasks.map((t: any) => t.id)).toEqual([other.id])

    // Taken off: not picked up for them again.
    await req('POST', `/reports/${james.id}/dismiss`, { task_id: imported.id })
    j = await byName('James')
    expect(j.from_tasks.map((t: any) => t.id)).toEqual([pricing.id])
    // Linked by hand shows once, as Tom's point; taking it off keeps it off.
    await req('POST', `/reports/${james.id}/points`, { task_id: pricing.id })
    await req('POST', `/reports/${james.id}/points`, { task_id: pricing.id })
    j = await byName('James')
    expect(j.from_tasks).toEqual([])
    expect(j.points.find((p: any) => p.kind === 'task')).toMatchObject({ task: { id: pricing.id } })
    await req('POST', `/reports/${james.id}/dismiss`, { task_id: pricing.id })
    j = await byName('James')
    expect([j.points.length, j.from_tasks.length]).toEqual([1, 0])
  })

  it('writes the prep sheet from the list', async () => {
    const d = await byName('Danielle')
    await req('PATCH', `/reports/${d.id}`, { notes: 'Wants to lead the onboarding revamp' })
    await req('POST', `/reports/${d.id}/points`, { text: 'Onboarding time for new clients', kind: 'focus' })
    await task('Danielle to rewrite the onboarding checklist')
    replies.one_to_one = ['Open with: agree the onboarding target.']
    const r = (await req('POST', `/reports/${d.id}/prep`)).data
    expect(r.prep).toBe('Open with: agree the onboarding target.')
    const c = calls.find((x) => x.role === 'one_to_one')!
    expect((c.payload as any).person).toEqual({ name: 'Danielle', area: 'Enablement', standing_notes: 'Wants to lead the onboarding revamp' })
    expect((c.payload as any).focus_points).toEqual(['Onboarding time for new clients'])
    expect((c.payload as any).open_tasks.map((t: any) => t.title)).toEqual(['Danielle to rewrite the onboarding checklist'])
    expect(c.system).toContain('Employment Hero')
    expect(c.system).toContain('no em dashes')
  })

  it('marking a 1-2-1 done closes Tom\'s points, keeps no notes, and starts the next list from today', async () => {
    const s = await byName('Sandeep')
    const a = (await req('POST', `/reports/${s.id}/points`, { text: 'Three-day close slipping at two clients' })).data
    const b = (await req('POST', `/reports/${s.id}/points`, { text: 'Cash forecast for the bank' })).data
    const old = await task('Sandeep to fix the Bentleys close')
    await one(`UPDATE reports SET prep = 'old prep' WHERE id = $1`, [s.id])
    const r = (await req('POST', `/reports/${s.id}/held`, { notes: 'ignored', carry_over: [b.id] })).data
    expect(r.last_held).toBe(londonToday())
    expect(r.since).toBe(londonToday())
    expect(r.next_on).toBe(addDays(londonToday(), 14))
    expect(r.prep).toBeNull()
    expect(r.points.map((p: any) => p.id)).toEqual([b.id])
    expect((await one(`SELECT status FROM report_points WHERE id = $1`, [a.id]))!.status).toBe('discussed')
    // Still open, so still on the list: not new since last time.
    expect(r.from_tasks).toEqual([expect.objectContaining({ id: old.id, new_since_last: false })])
    expect(await q(`SELECT * FROM memory_notes`)).toEqual([])
  })

  it('Ask Aimelia can add to a 1-2-1 list by name or area, and read it back', async () => {
    replies.chat = [{ tool_calls: [
      { tool: 'add_one_to_one_point', args: { person: 'commercial', text: 'Why did the Corrigans renewal slip?' } },
      { tool: 'add_one_to_one_point', args: { person: 'David', text: 'Dashboard release date', kind: 'task' } },
      { tool: 'add_one_to_one_point', args: { person: 'Nobody', text: 'x' } },
    ] }, { tool_calls: [{ tool: 'one_to_one_prep', args: { person: 'James' } }] }, { reply: 'Done.' }]
    await call(chat as any, { method: 'POST', path: '/api/chat/chats', body: { message: 'Add to my 1-2-1s' } })
    expect((await byName('James')).points.map((p: any) => [p.kind, p.text, p.source])).toEqual([['focus', 'Why did the Corrigans renewal slip?', 'chat']])
    expect((await byName('David G')).points.map((p: any) => [p.kind, p.text])).toEqual([['task', 'Dashboard release date']])
    const read = JSON.stringify(calls.filter((c) => c.role === 'chat').at(-1)!.messages)
    expect(read).toContain('Why did the Corrigans renewal slip?')
    expect(calls.find((c) => c.role === 'chat')!.system).toContain('1-2-1 notes are kept in Employment Hero')
    expect(read).toContain('no direct report matches')
  })

  it('a task can be put on a 1-2-1 list from the task', async () => {
    const t = await task('VAT return for the Soho group')
    const n = (await req('GET', '/reports?lite=true')).data.reports.find((r: any) => r.name === 'Natasha')
    expect(n.points).toBeUndefined()
    expect((await req('POST', `/reports/${n.id}/points`, { task_id: t.id, kind: 'task' })).status).toBe(201)
    expect((await byName('Natasha')).points[0]).toMatchObject({ kind: 'task', text: 'VAT return for the Soho group', task: { id: t.id } })
    expect((await req('POST', `/reports/${n.id}/points`, { text: '' })).status).toBe(400)
  })
})
