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

  it('keeps focus points and tasks that have cropped up, and offers open tasks that mention them', async () => {
    const james = await byName('James')
    await req('POST', `/reports/${james.id}/points`, { text: 'Pipeline for Q4: three new groups signed' })
    const pricing = await task('Chase James on the Soho pricing proposal')
    const other = await task('Board pack', 'Natasha to send the ops numbers')
    await task('Jameson whisky order') // not a whole-word match
    let j = await byName('James')
    expect(j.points.map((p: any) => [p.kind, p.text])).toEqual([['focus', 'Pipeline for Q4: three new groups signed']])
    expect(j.cropped_up.map((t: any) => t.title)).toEqual(['Chase James on the Soho pricing proposal'])
    expect((await byName('Natasha')).cropped_up.map((t: any) => t.id)).toEqual([other.id])

    // Added from the suggestion: linked to the task, and no longer offered. Adding it again does not duplicate it.
    await req('POST', `/reports/${james.id}/points`, { task_id: pricing.id })
    await req('POST', `/reports/${james.id}/points`, { task_id: pricing.id })
    j = await byName('James')
    expect(j.cropped_up).toEqual([])
    const linked = j.points.find((p: any) => p.kind === 'task')
    expect(linked).toMatchObject({ text: 'Chase James on the Soho pricing proposal', task: { id: pricing.id, status: 'queued' } })
    expect(j.points.length).toBe(2)

    // Dismissed: not offered again.
    const natasha = await byName('Natasha')
    await req('POST', `/reports/${natasha.id}/dismiss`, { task_id: other.id })
    expect((await byName('Natasha')).cropped_up).toEqual([])
    expect((await byName('Natasha')).points).toEqual([])

    // Dropped points leave the list.
    await req('PATCH', `/report-points/${linked.id}`, { status: 'dropped' })
    expect((await byName('James')).points.length).toBe(1)
  })

  it('writes the prep sheet from the list, the tasks and last time', async () => {
    const d = await byName('Danielle')
    await req('PATCH', `/reports/${d.id}`, { notes: 'Wants to lead the onboarding revamp' })
    await req('POST', `/reports/${d.id}/points`, { text: 'Onboarding time for new clients', kind: 'focus' })
    replies.one_to_one = ['Open with: agree the onboarding target.']
    const r = (await req('POST', `/reports/${d.id}/prep`)).data
    expect(r.prep).toBe('Open with: agree the onboarding target.')
    const c = calls.find((x) => x.role === 'one_to_one')!
    expect((c.payload as any).person).toEqual({ name: 'Danielle', area: 'Enablement', standing_notes: 'Wants to lead the onboarding revamp' })
    expect((c.payload as any).focus_points).toEqual(['Onboarding time for new clients'])
    expect(c.system).toContain('no em dashes')
  })

  it('closes what a 1-2-1 covered, carries the rest over, keeps the notes and sets the next date', async () => {
    const s = await byName('Sandeep')
    const a = (await req('POST', `/reports/${s.id}/points`, { text: 'Three-day close slipping at two clients' })).data
    const b = (await req('POST', `/reports/${s.id}/points`, { text: 'Cash forecast for the bank' })).data
    await one(`UPDATE reports SET prep = 'old prep' WHERE id = $1`, [s.id])
    const r = (await req('POST', `/reports/${s.id}/held`, { notes: 'Sandeep to fix the close at Bentleys by Friday', carry_over: [b.id] })).data
    expect(r.last_held).toBe(londonToday())
    expect(r.next_on).toBe(addDays(londonToday(), 14))
    expect(r.prep).toBeNull()
    expect(r.points.map((p: any) => p.id)).toEqual([b.id])
    expect(r.history[0]).toMatchObject({ notes: 'Sandeep to fix the close at Bentleys by Friday', points: [{ text: 'Three-day close slipping at two clients' }] })
    expect((await one(`SELECT status FROM report_points WHERE id = $1`, [a.id]))!.status).toBe('discussed')
    expect((await q(`SELECT source, context FROM memory_notes`))[0]).toMatchObject({ source: 'one_to_one', context: { person: 'Sandeep' } })
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
