import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { chatEndpoints } from '@/lib/chat/api'
import { MAX_STEPS } from '@/lib/chat/agent'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { one, q } from '@/lib/db'
import { call } from './helpers'

const api = dispatcher('/api/chat', chatEndpoints)
const req = (method: string, path: string, b?: unknown) => call(api as any, { method, path: `/api/chat${path}`, body: b })

/** Plays back model replies in order, and keeps every call so tests can read what the model was shown. */
function script(...replies: unknown[]) {
  const calls: ModelCall[] = []
  setModelTransport(async (c) => {
    calls.push(c)
    const next = replies.length > 1 ? replies.shift() : replies[0]
    return typeof next === 'string' ? next : JSON.stringify(next)
  })
  return calls
}

beforeEach(() => { setLaterHook(() => {}) })
afterEach(() => { setModelTransport(null); setLaterHook(null) })

describe('Ask Aimelia', () => {
  it('answers straight away when no lookup is needed, and keeps the conversation', async () => {
    script({ reply: 'Morning Tom.' })
    const r = await req('POST', '/chats', { message: 'Morning' })
    expect(r.status).toBe(201)
    expect(r.data.chat.title).toBe('Morning')
    expect(r.data.messages.map((m: any) => [m.role, m.content])).toEqual([['user', 'Morning'], ['assistant', 'Morning Tom.']])
    const list = await req('GET', '/chats')
    expect(list.data.chats).toHaveLength(1)
    expect(list.data.tools.map((t: any) => t.name)).toContain('search_tasks')
    // Microsoft 365 and the WS systems are not connected in tests, so their tools are not offered.
    expect(list.data.tools.map((t: any) => t.name)).not.toContain('upcoming_meetings')
    expect(list.data.tools.map((t: any) => t.name)).not.toContain('ws_lookup')
  })

  it('looks things up, feeds the results back, and records the steps', async () => {
    await q(`INSERT INTO tasks (title, notes, status) VALUES ('Bentleys VAT return', 'Q2', 'ready'), ('Book dentist', '', 'queued')`)
    const calls = script({ tool_calls: [{ tool: 'search_tasks', args: { query: 'vat' } }] }, { reply: 'One VAT task, ready for you.' })
    const r = await req('POST', '/chats', { message: 'Where is the VAT work?' })
    expect(r.data.messages[1].content).toBe('One VAT task, ready for you.')
    expect(r.data.messages[1].steps).toEqual([{ tool: 'search_tasks', args: { query: 'vat' }, ok: true, note: '' }])
    expect(calls).toHaveLength(2)
    const results = calls[1].messages.at(-1)!.content
    expect(results).toContain('Bentleys VAT return')
    expect(results).not.toContain('Book dentist')
    expect(calls[0].system).toContain('No emojis') // the house rules go to the chat agent too
  })

  it('adds a task when asked, queued for the agent team and marked as from the chat', async () => {
    script({ tool_calls: [{ tool: 'create_task', args: { title: 'Chase Bentleys payroll sign-off', notes: 'June run', priority: 1, due_date: '2026-10-02' } }] },
      { reply: 'Added: Chase Bentleys payroll sign-off.' })
    const r = await req('POST', '/chats', { message: 'Add a task to chase Bentleys for the June payroll sign-off by Friday, high priority' })
    expect(r.data.messages[1].steps[0]).toMatchObject({ tool: 'create_task', ok: true })
    const t = await one(`SELECT * FROM tasks`)
    expect(t).toMatchObject({ title: 'Chase Bentleys payroll sign-off', notes: 'June run', priority: 1, due_date: '2026-10-02', status: 'queued', source: 'chat' })
  })

  it('answers an agent question and sends the task back to the team', async () => {
    const [t] = await q(`INSERT INTO tasks (title, status) VALUES ('Tronc review', 'needs_input') RETURNING id`)
    const [qn] = await q(`INSERT INTO questions (task_id, asked_by, question) VALUES ($1, 'Planner', 'Which site?') RETURNING id`, [t.id])
    script({ tool_calls: [{ tool: 'answer_question', args: { question_id: qn.id, answer: 'Mayfair' } }] }, { reply: 'Done.' })
    await req('POST', '/chats', { message: 'Tell the tronc review it is Mayfair' })
    expect(await one(`SELECT answer, status FROM questions WHERE id = $1`, [qn.id])).toEqual({ answer: 'Mayfair', status: 'answered' })
    expect((await one(`SELECT status FROM tasks WHERE id = $1`, [t.id]))!.status).toBe('queued')
  })

  it('refuses tools it does not have, and survives a tool that fails', async () => {
    const calls = script({ tool_calls: [{ tool: 'send_email', args: { to: 'x@y.com' } }, { tool: 'get_task', args: { id: 'nope' } }] }, { reply: 'I cannot send email.' })
    const r = await req('POST', '/chats', { message: 'Email the client' })
    expect(r.data.messages[1].steps.map((s: any) => [s.tool, s.ok])).toEqual([['send_email', false], ['get_task', true]])
    expect(calls[1].messages.at(-1)!.content).toContain('Unknown or unavailable tool')
  })

  it('carries the conversation forward and takes plain text as the reply', async () => {
    script('Plain answer, no JSON.')
    const first = await req('POST', '/chats', { message: 'First' })
    expect(first.data.messages[1].content).toBe('Plain answer, no JSON.')
    const calls = script({ reply: 'Second answer.' })
    const second = await req('POST', '/chats', { message: 'Second', chat_id: first.data.chat.id })
    expect(second.status).toBe(200)
    expect(calls[0].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect((await req('GET', `/chats/${first.data.chat.id}`)).data.messages).toHaveLength(4)
  })

  it('stops after the step limit rather than looping', async () => {
    const calls = script({ tool_calls: [{ tool: 'briefing', args: {} }] })
    const r = await req('POST', '/chats', { message: 'Loop forever' })
    expect(calls).toHaveLength(MAX_STEPS)
    expect(r.data.messages[1].content).toContain('ran out of steps')
  })

  it('keeps Tom\'s message when the model fails, and deletes conversations', async () => {
    setModelTransport(async () => { throw new Error('overloaded') })
    const r = await req('POST', '/chats', { message: 'Hello' })
    expect(r.status).toBe(502)
    const [c] = await q(`SELECT id FROM chats`)
    expect((await req('GET', `/chats/${c.id}`)).data.messages.map((m: any) => m.content)).toEqual(['Hello'])
    expect((await req('DELETE', `/chats/${c.id}`)).status).toBe(204)
    expect((await req('GET', `/chats/${c.id}`)).status).toBe(404)
    expect(await q(`SELECT * FROM chat_messages`)).toEqual([])
  })

  it('works with no AI key, on the placeholder', async () => {
    const r = await req('POST', '/chats', { message: 'Hi' })
    expect(r.data.messages[1].content).toContain('no AI key')
  })
})
