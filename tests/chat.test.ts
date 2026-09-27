import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('Ask Aimelia with files', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF').toString('base64')
  const b64 = (s: string) => Buffer.from(s).toString('base64')

  it('shows a photo to the model, stores it, and serves it back', async () => {
    const calls = script({ reply: 'A receipt for £42.50 from Booker.' })
    const r = await req('POST', '/chats', { message: 'What is this?', files: [{ name: 'receipt.png', data: PNG }] })
    expect(r.status).toBe(201)
    const last = calls[0].messages.at(-1)!
    expect(last.files).toEqual([{ kind: 'image', media_type: 'image/png', data: PNG, name: 'receipt.png' }])
    expect(last.content).toContain('[Attached: receipt.png]')
    const f = r.data.messages[0].files[0]
    expect(f).toMatchObject({ name: 'receipt.png', kind: 'image', media_type: 'image/png', size: 68 })
    expect(f.data).toBeUndefined() // the bytes are never in the JSON
    const got = await call(api as any, { path: `/api/chat/files/${f.id}` })
    expect(got.status).toBe(200)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await req('GET', `/chats/${r.data.chat.id}`)).data.messages[0].files).toHaveLength(1)
  })

  it('takes a file with no message, and names the conversation after it', async () => {
    const calls = script({ reply: 'An HMRC letter.' })
    const r = await req('POST', '/chats', { files: [{ name: 'hmrc.pdf', data: PDF }] })
    expect(r.data.chat.title).toBe('Sent hmrc.pdf')
    expect(calls[0].messages.at(-1)!.files![0]).toMatchObject({ kind: 'pdf', media_type: 'application/pdf' })
    expect(calls[0].messages.at(-1)!.content).toContain('No message')
  })

  it('reads documents as text inside the message', async () => {
    const calls = script({ reply: 'Two actions.' })
    await req('POST', '/chats', { message: 'Actions?', files: [{ name: 'minutes.txt', data: b64('- Mandy to chase Corrigans\n- Tom to sign VAT') }] })
    const last = calls[0].messages.at(-1)!
    expect(last.files).toBeUndefined()
    expect(last.content).toContain('[Attached document: minutes.txt]')
    expect(last.content).toContain('Mandy to chase Corrigans')
  })

  it('refuses what it cannot read, before storing anything', async () => {
    script({ reply: 'x' })
    const bad = [
      [{ name: 'fake.png', data: b64('not really a picture') }, 'not a photo'],
      [{ name: 'fake.pdf', data: b64('hello') }, 'not a PDF'],
      [{ name: 'photo.heic', data: b64('ftypheic....') }, 'HEIC'],
      [{ name: 'tool.exe', data: b64('MZ....') }, 'cannot read'],
    ] as const
    for (const [file, says] of bad) {
      const r = await req('POST', '/chats', { message: 'look', files: [file] })
      expect(r.status, file.name).toBe(422)
      expect(r.data.detail).toContain(says)
    }
    expect((await req('POST', '/chats', { message: '' })).status).toBe(422)
    expect((await req('POST', '/chats', { message: 'x', files: Array(6).fill({ name: 'a.png', data: PNG }) })).status).toBe(422)
    expect((await req('POST', '/chats', { message: 'x', files: [{ name: 'big.png', data: 'A'.repeat(4_300_000) }] })).status).toBe(422)
    expect(await q(`SELECT * FROM chats`)).toEqual([])
    expect(await q(`SELECT * FROM chat_files`)).toEqual([])
  })

  it('stops re-sending old photos once they are out of view', async () => {
    script({ reply: 'Seen.' })
    const first = await req('POST', '/chats', { message: 'Photo', files: [{ name: 'board.png', data: PNG }] })
    const id = first.data.chat.id
    for (const m of ['one', 'two']) await req('POST', '/chats', { message: m, chat_id: id })
    let calls = script({ reply: 'ok' })
    await req('POST', '/chats', { message: 'three', chat_id: id }) // 7 messages now: the photo's is the oldest, outside the last 6
    expect(calls[0].messages.some((m) => m.files?.length)).toBe(false)
    expect(calls[0].messages[0].content).toContain('board.png earlier; it is no longer in view')
    calls = script({ reply: 'ok' })
    await req('POST', '/chats', { message: 'again', chat_id: id, files: [{ name: 'board.png', data: PNG }] })
    expect(calls[0].messages.at(-1)!.files).toHaveLength(1)
  })

  it('files text in the knowledge base when asked', async () => {
    script({ tool_calls: [{ tool: 'add_to_knowledge', args: { title: 'Tronc policy 2026', text: 'Tips are shared by points.', kind: 'policy' } }] }, { reply: 'Filed.' })
    const r = await req('POST', '/chats', { message: 'File this as our tronc policy', files: [{ name: 'tronc.txt', data: b64('Tips are shared by points.') }] })
    expect(r.data.messages[1].steps[0]).toMatchObject({ tool: 'add_to_knowledge', ok: true })
    expect(await one(`SELECT source, title, chunk FROM kb_chunks`)).toEqual({ source: 'policy', title: 'Tronc policy 2026', chunk: 'Tips are shared by points.' })
  })

  it('says which files arrived when there is no AI key', async () => {
    const r = await req('POST', '/chats', { files: [{ name: 'receipt.png', data: PNG }] })
    expect(r.data.messages[1].content).toContain('receipt.png')
  })

  it('sends photos and PDFs to Claude as image and document blocks, and photos to OpenAI as images', async () => {
    setModelTransport(null)
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body))
      const openai = String(_url).includes('openai')
      return new Response(JSON.stringify(openai
        ? { id: 'x', object: 'chat.completion', created: 0, model: 'gpt-4o', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"reply":"ok"}' } }] }
        : { id: 'x', type: 'message', role: 'assistant', model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"reply":"ok"}' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    await req('POST', '/chats', { message: 'Read these', files: [{ name: 'r.png', data: PNG }, { name: 'l.pdf', data: PDF }] })
    const content = bodies[0].messages.at(-1).content
    expect(content.map((c: any) => c.type)).toEqual(['image', 'document', 'text'])
    expect(content[0].source).toEqual({ type: 'base64', media_type: 'image/png', data: PNG })
    delete process.env.ANTHROPIC_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test'
    await req('POST', '/chats', { message: 'And this', files: [{ name: 'r.png', data: PNG }] })
    const oa = bodies.at(-1).messages.at(-1).content
    expect(oa[0]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } })
    // OpenAI cannot read PDFs: said plainly, and the message is kept.
    const r = await req('POST', '/chats', { message: 'And this', files: [{ name: 'l.pdf', data: PDF }] })
    expect(r.status).toBe(502)
    expect(r.data.detail).toContain('Claude')
  })
})
