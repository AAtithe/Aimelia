import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { chatEndpoints } from '@/lib/chat/api'
import { CHAT_MODEL, converse, MAX_STEPS, resetChatModel } from '@/lib/chat/agent'
import { LLMError } from '@/lib/llm'
import { calculate } from '@/lib/chat/calc'
import { encrypt } from '@/lib/crypto'
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

beforeEach(() => { setLaterHook(() => {}); resetChatModel() })
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

describe('calculate', () => {
  it('does the sums an accountant needs, exactly', () => {
    expect(calculate('12,500 * 20%')).toBe(2500)
    expect(calculate('£1,000 + 2 * 3')).toBe(1006)
    expect(calculate('(4350 - 350) / 2')).toBe(2000)
    expect(calculate('round(4350 / 18200 * 100; 1)')).toBe(23.9)
    expect(calculate('0.1 + 0.2')).toBe(0.3)
    expect(calculate('-2 ^ 2')).toBe(-4)
    expect(calculate('sum(1; 2; 3) / max(1; 3)')).toBe(2)
    expect(calculate('2 ^ 3 ^ 2')).toBe(512)
    expect(calculate('2 ^ -1')).toBe(0.5)
    expect(calculate('10 - -5')).toBe(15)
  })
  it('refuses anything that is not arithmetic', () => {
    for (const bad of ['process.exit()', '1 / 0', '2 +', 'constructor', '(1', '1e400 * 1e400']) expect(() => calculate(bad), bad).toThrow()
  })
})

describe('Ask Aimelia, the full agent', () => {
  it('runs on the most capable model at high effort, with fallback, when the Claude key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const calls = script({ reply: 'Hello.' })
    await req('POST', '/chats', { message: 'Hi' })
    expect(calls[0]).toMatchObject({ provider: 'anthropic', model: CHAT_MODEL, effort: 'high', fallback: true })
    expect(calls[0]).toMatchObject({ retries: 1 })
    expect(calls[0].timeoutMs).toBeGreaterThan(130_000)
    expect(CHAT_MODEL).toBe('claude-opus-5-5')
    expect((await req('GET', '/chats')).data.model).toBe('claude-opus-5-5')
    process.env.CHAT_MODEL = 'claude-opus-5'
    await req('POST', '/chats', { message: 'Hi' })
    expect(calls.at(-1)!.model).toBe('claude-opus-5')
    delete process.env.CHAT_MODEL
  })

  it('works figures out with calculate and searches the web with sources, on Opus 5', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const seen: ModelCall[] = []
    const chatReplies: unknown[] = [
      { tool_calls: [{ tool: 'calculate', args: { sums: { vat: '12500 * 20%', bad: '1 / 0' } } }, { tool: 'web_search', args: { query: 'Current UK VAT registration threshold?' } }] },
      { reply: 'VAT is 2500. The threshold is 90,000 (gov.uk).' },
    ]
    setModelTransport(async (c) => {
      seen.push(c)
      if (c.role === 'web') return 'The threshold is 90,000.\n\nSources:\n- gov.uk: https://www.gov.uk/vat-registration'
      return JSON.stringify(chatReplies.shift())
    })
    const r = await req('POST', '/chats', { message: 'VAT on 12,500, and the registration threshold?' })
    expect(r.data.messages[1].steps.map((s: any) => [s.tool, s.ok])).toEqual([['calculate', true], ['web_search', true]])
    const web = seen.find((c) => c.role === 'web')!
    expect(web).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5', webSearch: 5 })
    const results = seen.at(-1)!.messages.at(-1)!.content
    expect(results).toContain('\\"vat\\":2500')
    expect(results).toContain('division by zero')
    expect(results).toContain('https://www.gov.uk/vat-registration')
  })

  it('moves to Opus 5 if this account cannot use the default model, and remembers', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    resetChatModel()
    const models: string[] = []
    setModelTransport(async (c) => {
      models.push(String(c.model))
      if (c.model === CHAT_MODEL) throw new LLMError('anthropic claude-opus-5-5: 404 {"type":"not_found_error","message":"model: claude-opus-5-5"}')
      return '{"reply":"ok"}'
    })
    expect((await req('POST', '/chats', { message: 'Hi' })).data.messages[1].content).toBe('ok')
    await req('POST', '/chats', { message: 'Again' })
    expect(models).toEqual([CHAT_MODEL, 'claude-opus-5', 'claude-opus-5'])
    expect((await req('GET', '/chats')).data.model).toBe('claude-opus-5')
    // An overload is not a refusal: it is reported, not worked around.
    resetChatModel()
    setModelTransport(async () => { throw new LLMError('anthropic claude-opus-5-5: 529 overloaded') })
    expect((await req('POST', '/chats', { message: 'Hi' })).status).toBe(502)
    expect((await req('GET', '/chats')).data.model).toBe(CHAT_MODEL)
  })

  it('searches the web on Opus 5 too if this account cannot use Opus 5.5', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const models: string[] = []
    const chatReplies: unknown[] = [{ tool_calls: [{ tool: 'web_search', args: { query: 'VAT threshold?' } }] }, { reply: '90,000.' }]
    setModelTransport(async (c) => {
      if (c.role === 'web') {
        models.push(String(c.model))
        if (c.model === CHAT_MODEL) throw new LLMError('anthropic claude-opus-5-5: 403 {"type":"permission_error"}')
        return 'The threshold is 90,000.'
      }
      return JSON.stringify(chatReplies.shift())
    })
    const r = await req('POST', '/chats', { message: 'VAT threshold?' })
    expect(r.data.messages[1].steps[0]).toMatchObject({ tool: 'web_search', ok: true })
    expect(models).toEqual([CHAT_MODEL, 'claude-opus-5'])
  })

  it('does not offer web search or the Microsoft tools when they cannot run', async () => {
    const names = (await req('GET', '/chats')).data.tools.map((t: any) => t.name)
    for (const t of ['web_search', 'search_email', 'read_email', 'draft_email', 'meeting_brief', 'book_focus_time', 'upcoming_meetings']) expect(names).not.toContain(t)
    for (const t of ['calculate', 'update_task', 'remember', 'forget', 'search_conversations']) expect(names).toContain(t)
  })

  it('edits tasks when asked: dates, notes, closing and sending back', async () => {
    const [t] = await q(`INSERT INTO tasks (title, notes, status) VALUES ('Corrigans tronc', 'Q3', 'ready') RETURNING id`)
    script({ tool_calls: [{ tool: 'update_task', args: { id: t.id, due_date: '2026-10-09', append_note: 'Tom: use the new points scheme', priority: 1 } }] }, { reply: 'Updated.' })
    await req('POST', '/chats', { message: 'Move Corrigans tronc to the 9th, top priority, and note the new points scheme' })
    expect(await one(`SELECT notes, due_date, priority, status FROM tasks WHERE id = $1`, [t.id]))
      .toEqual({ notes: 'Q3\nTom: use the new points scheme', due_date: '2026-10-09', priority: 1, status: 'ready' })
    script({ tool_calls: [{ tool: 'update_task', args: { id: t.id, status: 'done' } }] }, { reply: 'Closed.' })
    await req('POST', '/chats', { message: 'Close it' })
    expect((await one(`SELECT status FROM tasks WHERE id = $1`, [t.id]))!.status).toBe('done')
    await q(`UPDATE tasks SET status = 'processing' WHERE id = $1`, [t.id])
    const calls = script({ tool_calls: [{ tool: 'update_task', args: { id: t.id, status: 'queued' } }] }, { reply: 'Busy.' })
    await req('POST', '/chats', { message: 'Send it back' })
    expect(calls[1].messages.at(-1)!.content).toContain('working on it right now')
    expect((await one(`SELECT status FROM tasks WHERE id = $1`, [t.id]))!.status).toBe('processing')
  })

  it('remembers what Tom says across conversations, and forgets on request', async () => {
    script({ tool_calls: [{ tool: 'remember', args: { fact: 'Mandy Lee runs payroll; delegate payroll chasing to her.' } }] }, { reply: 'Noted.' })
    await req('POST', '/chats', { message: 'Remember Mandy runs payroll' })
    const calls = script({ reply: 'Mandy.' })
    await req('POST', '/chats', { message: 'Who runs payroll?' }) // a new conversation
    expect(calls[0].system).toContain('Mandy Lee runs payroll')
    // One memory for everything: it shows on What Aimelia knows as Tom's own, and the agent team gets it too.
    const [m] = await q(`SELECT id, pinned, created_by, status FROM memories`)
    expect([m.pinned, m.created_by, m.status]).toEqual([true, 'tom', 'active'])
    script({ tool_calls: [{ tool: 'forget', args: { id: m.id } }] }, { reply: 'Forgotten.' })
    await req('POST', '/chats', { message: 'Forget that' })
    expect((await one(`SELECT status FROM memories WHERE id = $1`, [m.id]))!.status).toBe('archived') // Tom can bring it back
    const next = script({ reply: 'No one on record.' })
    await req('POST', '/chats', { message: 'Who runs payroll?' })
    expect(next[0].system).not.toContain('Mandy Lee runs payroll')
  })

  it('facts kept by the earlier Ask Aimelia memory move into What Aimelia knows, once', async () => {
    await q(`INSERT INTO chat_memory (fact, created_at) VALUES ('Tom signs off emails Best, Tom', '2026-09-20T10:00:00Z')`)
    const calls = script({ reply: 'Hello.' })
    await req('POST', '/chats', { message: 'Morning' })
    expect(calls[0].system).toContain('Tom signs off emails Best, Tom')
    expect(await q(`SELECT * FROM chat_memory`)).toEqual([])
    const moved = await q(`SELECT content, pinned, created_at FROM memories`)
    expect(moved.map((r) => [r.content, r.pinned, new Date(r.created_at).toISOString()])).toEqual([['Tom signs off emails Best, Tom', true, '2026-09-20T10:00:00.000Z']])
  })

  it('searches earlier conversations', async () => {
    script({ reply: 'The Soho group wants six sites priced.' })
    await req('POST', '/chats', { message: 'Note on the Soho group pricing' })
    const calls = script({ tool_calls: [{ tool: 'search_conversations', args: { query: 'soho' } }] }, { reply: 'Found it.' })
    await req('POST', '/chats', { message: 'What did we say about Soho?' })
    expect(calls[1].messages.at(-1)!.content).toContain('six sites priced')
  })

  it('replies when the time budget runs out instead of running past Vercel\'s limit', async () => {
    let clock = 0
    const calls = script({ tool_calls: [{ tool: 'briefing', args: {} }] })
    const out = await converse([{ role: 'user', content: 'Dig deep' }], () => (clock += 100_000))
    expect(calls.length).toBeLessThan(MAX_STEPS)
    expect(calls.at(-1)!.messages.at(-1)!.content).toContain('No more tools')
    expect(out.reply).toContain('ran out of steps')
  })
})

describe('Ask Aimelia in Outlook', () => {
  const hits: { method: string; path: string; query: URLSearchParams; body: any }[] = []
  beforeEach(async () => {
    hits.length = 0
    await q(`INSERT INTO ms_tokens (owner, account, access_token, refresh_token, expires_at) VALUES ('owner', 'owner@example.co', $1, $2, now() + interval '1 hour')`,
      [encrypt('graph-token'), encrypt('refresh')])
    vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
      const url = new URL(input)
      const method = init.method || 'GET'
      hits.push({ method, path: url.pathname, query: url.searchParams, body: init.body ? JSON.parse(init.body) : null })
      if (method === 'GET' && url.pathname.endsWith('/me/messages')) return Response.json({ value: [{ id: 'm1', subject: 'Bentleys payroll', from: { emailAddress: { address: 'sam@bentleys.co', name: 'Sam' } }, bodyPreview: 'Can you confirm', receivedDateTime: '2026-09-26T10:00:00Z' }] })
      if (method === 'GET' && url.pathname.endsWith('/me/messages/m1')) return Response.json({ id: 'm1', subject: 'Bentleys payroll', from: { emailAddress: { address: 'sam@bentleys.co' } }, body: { content: 'Can you confirm the June run by Friday?' } })
      if (method === 'POST' && url.pathname.endsWith('/createReply')) return Response.json({ id: 'd1', webLink: 'https://outlook/d1', subject: 'RE: Bentleys payroll' })
      if (method === 'PATCH') return Response.json({})
      return new Response('{}', { status: 404 })
    }))
  })

  it('searches the mailbox, reads the email, and saves a threaded reply draft without sending', async () => {
    const calls = script(
      { tool_calls: [{ tool: 'search_email', args: { query: 'Bentleys payroll' } }] },
      { tool_calls: [{ tool: 'read_email', args: { id: 'm1' } }] },
      { tool_calls: [{ tool: 'draft_email', args: { reply_to_id: 'm1', body: 'Hi Sam,\n\nConfirmed for Friday.\n\nBest regards,\nTom' } }] },
      { reply: 'Draft saved in Outlook, not sent.' })
    const r = await req('POST', '/chats', { message: 'Find Sam\'s Bentleys payroll email and draft a reply confirming Friday' })
    expect(r.data.messages[1].steps.map((s: any) => s.tool)).toEqual(['search_email', 'read_email', 'draft_email'])
    expect(hits.find((h) => h.path.endsWith('/me/messages') && h.method === 'GET')!.query.get('$search')).toBe('"Bentleys payroll"')
    expect(calls.at(-1)!.messages.map((m) => m.content).join('\n')).toContain('June run by Friday')
    expect(hits.find((h) => h.path.endsWith('/createReply'))!.body.comment).toContain('Confirmed for Friday')
    expect(hits.some((h) => /send/i.test(h.path))).toBe(false)
  })
})

describe('Claude requests for the agent', () => {
  const bodies: { url: string; headers: Record<string, string>; body: any }[] = []
  const claude = (content: unknown[], stop = 'end_turn') => new Response(JSON.stringify({ id: 'x', type: 'message', role: 'assistant', model: 'm', stop_reason: stop, content, usage: { input_tokens: 1, output_tokens: 1 } }),
    { status: 200, headers: { 'content-type': 'application/json' } })
  beforeEach(() => { bodies.length = 0; setModelTransport(null); process.env.ANTHROPIC_API_KEY = 'sk-test' })

  it('asks for fallback, effort and a streamed reply on the chat model', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
      bodies.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body) })
      const text = '{"reply":"ok"}'
      // A streamed reply, as the SDK expects when stream is true.
      const events = [
        { type: 'message_start', message: { id: 'x', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }))
    const r = await req('POST', '/chats', { message: 'Hi' })
    expect(r.data.messages[1].content).toBe('ok')
    const b = bodies[0]
    expect(b.body).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'high' }, fallbacks: 'default', stream: true, max_tokens: 16000 })
    expect(b.body.temperature).toBeUndefined()
    expect(b.body.thinking).toBeUndefined()
    expect(b.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01')
  })

  it('runs the request without fallback where fallback is not offered', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body)
      bodies.push({ url: String(url), headers: {}, body })
      if (body.fallbacks) return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: not supported' } }), { status: 400, headers: { 'content-type': 'application/json' } })
      return claude([{ type: 'text', text: 'plain' }])
    }))
    const { complete } = await import('@/lib/llm')
    expect(await complete({ provider: 'anthropic', model: 'claude-opus-5-5', role: 'x', system: 's', messages: [{ role: 'user', content: 'hi' }], fallback: true })).toBe('plain')
    expect(bodies.map((b) => !!b.body.fallbacks)).toEqual([true, false])
  })

  it('searches the web with the server tool, carries on after a pause, and lists the sources', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body)
      bodies.push({ url: String(url), headers: {}, body })
      if (bodies.length === 1) return claude([{ type: 'text', text: 'Searching. ' }], 'pause_turn')
      return claude([{ type: 'text', text: 'The threshold is 90,000.', citations: [{ type: 'web_search_result_location', url: 'https://www.gov.uk/vat-registration', title: 'VAT registration', cited_text: '90,000', encrypted_index: 'x' }] }])
    }))
    const { complete } = await import('@/lib/llm')
    const out = await complete({ provider: 'anthropic', model: 'claude-opus-5-5', role: 'web', system: 's', messages: [{ role: 'user', content: 'threshold?' }], webSearch: 5 })
    expect(bodies[0].body.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }])
    expect(bodies[1].body.messages.at(-1).role).toBe('assistant') // the paused turn sent back to continue
    expect(out).toContain('The threshold is 90,000.')
    expect(out).toContain('Sources:\n- VAT registration: https://www.gov.uk/vat-registration')
  })
})
