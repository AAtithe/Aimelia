import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { encrypt } from '@/lib/crypto'
import { q } from '@/lib/db'
import { docxToText, transcriptToText } from '@/lib/agents/importText'
import { csvItems, runImportJobs, salvageTasks, ukDate } from '@/lib/agents/imports'
import { call } from './helpers'

const api = dispatcher('/api/todo', todoEndpoints)
const req = (method: string, path: string, b?: unknown) => call(api as any, { method, path: `/api/todo${path}`, body: b })

/** A minimal .docx: a zip holding word/document.xml, deflated as Word does. */
function docx(xml: string): Buffer {
  const name = Buffer.from('word/document.xml')
  const raw = Buffer.from(xml)
  const data = deflateRawSync(raw)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28)
  const cdStart = 30 + name.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdStart, 16)
  return Buffer.concat([local, name, data, central, name, end])
}
const p = (text: string, list = false) => `<w:p>${list ? '<w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>' : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
const MINUTES = `<w:document><w:body>${p('Bentleys quarterly review')}${p('We talked about labour at 34% &amp; rising.')}${p('Chase Corrigans for Q3 tronc sign-off', true)}${p('Book the Soho pricing call', true)}<w:tbl><w:tr><w:tc>${p('Owner')}</w:tc><w:tc>${p('Mandy')}</w:tc></w:tr></w:tbl><w:del><w:r><w:t>deleted words</w:t></w:r></w:del></w:body></w:document>`

const models: ModelCall[] = []
let replies: Record<string, unknown> = {}
type Hit = { method: string; url: URL; body: any; headers: Record<string, string> }
let hits: Hit[] = []
let routes: [RegExp, string, (h: Hit) => unknown][] = []
const on = (method: string, re: RegExp, fn: (h: Hit) => unknown) => routes.push([re, method, fn])

beforeEach(() => {
  setLaterHook(() => {})
  models.length = 0
  replies = {}
  hits = []
  routes = []
  setModelTransport(async (c) => { models.push(c); return JSON.stringify(replies[c.role] ?? {}) })
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
    const url = new URL(input)
    const h = { method: init.method || 'GET', url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} }
    hits.push(h)
    for (const [re, m, fn] of routes) if (m === h.method && re.test(url.pathname)) { const out = fn(h); return out instanceof Response ? out : Response.json(out ?? {}) }
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { setModelTransport(null); setLaterHook(null) })

describe('reading files', () => {
  it('reads a Word document: paragraphs, list items, table rows; deleted text and entities handled', () => {
    expect(docxToText(docx(MINUTES)).split('\n')).toEqual([
      'Bentleys quarterly review', 'We talked about labour at 34% & rising.', '- Chase Corrigans for Q3 tronc sign-off', '- Book the Soho pricing call', 'Owner | Mandy'])
  })

  it('reads a transcript without timings', () => {
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Tom Stanley>Mandy, can you chase the P60s by Friday?</v>\n\n2\n00:00:05.000 --> 00:00:06.000\n<v Mandy>Will do.</v>'
    expect(transcriptToText(vtt)).toBe('Tom Stanley: Mandy, can you chase the P60s by Friday?\nMandy: Will do.')
  })

  it('salvages complete tasks from a reply cut off part way', () => {
    expect(salvageTasks('{"tasks": [{"title": "a } b"}, {"title": "c", "notes": "x\\"}"}, {"title": "d')).toEqual([{ title: 'a } b' }, { title: 'c', notes: 'x"}' }])
    expect(salvageTasks('no list here')).toEqual([])
    expect(salvageTasks('{"tasks": []} {"title": "not in the list"}')).toEqual([])
  })

  it('reads an Outlook tasks CSV: UK dates, priority, completed rows skipped', () => {
    const csv = 'Subject,Due Date,Priority,Complete,Notes\n"Chase Corrigans, tronc",31/10/2026,High,False,Q3\nOld task,01/01/2026,Normal,True,\nPrice Soho group,,Low,False,"6 sites\nnew group"'
    expect(csvItems(csv)).toEqual([
      { title: 'Chase Corrigans, tronc', notes: 'Q3', due_date: '2026-10-31', priority: 1 },
      { title: 'Price Soho group', notes: '6 sites\nnew group', due_date: null, priority: 3 },
    ])
    expect([ukDate('5/3/26'), ukDate('2026-03-05'), ukDate('13/13/2026')]).toEqual(['2026-03-05', '2026-03-05', null])
  })
})

/**
 * An AI import: the request answers 202 with a job at once. Run the job as the background would,
 * then read it back as the screen does.
 */
async function read(res: Promise<{ status: number; data: any }>) {
  const r = await res
  expect(r.status, JSON.stringify(r.data)).toBe(202)
  expect(r.data.job.status).toBe('queued')
  await runImportJobs()
  return (await req('GET', `/import/jobs/${r.data.job.id}`)).data as { job: any; tasks: any[] }
}

describe('importing documents and notes', () => {
  const upload = (filename: string, buf: Buffer, extra: Record<string, unknown> = {}) =>
    req('POST', '/import/file', { filename, data: buf.toString('base64'), run_now: false, ...extra })

  it('a Word document without an AI key: the list items become tasks, tagged with where they came from', async () => {
    setModelTransport(null) // placeholder model
    const { job, tasks } = await read(upload('Bentleys review minutes.docx', docx(MINUTES)))
    expect(job.status).toBe('done')
    expect(tasks.map((t: any) => t.title)).toEqual(['Chase Corrigans for Q3 tronc sign-off', 'Book the Soho pricing call'])
    expect(tasks[0].source).toBe('document')
    expect(tasks[0].notes).toContain('Imported from a document: Bentleys review minutes.')
    expect(tasks[0].status).toBe('queued')
  })

  it('the same document twice is refused unless forced', async () => {
    setModelTransport(null)
    expect((await read(upload('minutes.docx', docx(MINUTES)))).job.status).toBe('done')
    const again = await upload('minutes copy.docx', docx(MINUTES))
    expect(again.status).toBe(409)
    expect(again.data.task_count).toBe(2)
    expect((await read(upload('minutes copy.docx', docx(MINUTES), { force: true }))).job.status).toBe('done')
    expect((await req('GET', '/tasks')).data).toHaveLength(4)
  })

  it('two copies queued before either finishes: the second ends as a duplicate, not twice the tasks', async () => {
    setModelTransport(null)
    const a = await upload('minutes.docx', docx(MINUTES))
    const b = await upload('minutes again.docx', docx(MINUTES))
    expect([a.status, b.status]).toEqual([202, 202])
    await runImportJobs()
    expect((await req('GET', `/import/jobs/${b.data.job.id}`)).data.job).toMatchObject({ status: 'duplicate', prior: { task_count: 2 } })
    expect((await req('GET', '/tasks')).data).toHaveLength(2)
  })

  it('meeting notes go to the AI with the team directory; owners other than Tom are kept for Triage', async () => {
    await req('PATCH', '/pipeline', { team_directory: 'Mandy, Payroll Manager' })
    replies.import = { tasks: [
      { title: 'Chase P60s for Bentleys', notes: 'Agreed at the review', owner: 'Mandy', priority: 1, due_date: '2026-10-02' },
      { title: 'Send Soho proposal', notes: '', owner: 'Tom Stanley', priority: 'x', due_date: 'Friday' },
      { title: '', notes: 'junk' },
    ] }
    const { tasks } = await read(req('POST', '/import/text', { text: 'Mandy to chase P60s by Friday. Tom to send the Soho proposal.', kind: 'meeting', title: 'Bentleys review', run_now: false }))
    expect(models[0].role).toBe('import')
    expect(models[0].system).toContain('Mandy, Payroll Manager')
    expect(models[0].maxTokens).toBe(32000)
    expect(models[0].timeoutMs).toBeLessThan(300_000)
    expect((models[0].payload as any).source).toBe('meeting notes or transcript')
    expect(tasks.map((t: any) => [t.title, t.priority, t.due_date])).toEqual([['Chase P60s for Bentleys', 1, '2026-10-02'], ['Send Soho proposal', 2, null]])
    expect(tasks[0].notes).toContain('Owner named: Mandy')
    expect(tasks[1].notes).not.toContain('Owner named')
    expect(tasks[1].notes).toContain('Imported from meeting notes: Bentleys review.')
  })

  it('a pasted list is one task per line, at once, with no AI call', async () => {
    const r = await req('POST', '/import/text', { text: '- Chase P60s\n[ ] Book Soho call\n\n1. Chase P60s\nReview Sam pay case', kind: 'list', run_now: false })
    expect(r.status).toBe(201)
    expect(r.data.map((t: any) => t.title)).toEqual(['Chase P60s', 'Book Soho call', 'Review Sam pay case'])
    expect(models).toHaveLength(0)
  })

  it('never loses an import when the AI fails', async () => {
    setModelTransport(async () => { throw new Error('invalid x-api-key') })
    const { tasks } = await read(req('POST', '/import/text', { text: 'Notes from Monday\nAction: renew the linen contract\n- Chase Bentleys', kind: 'meeting', run_now: false }))
    expect(tasks.map((t: any) => t.title)).toEqual(['renew the linen contract', 'Chase Bentleys'])
  })

  it('refuses files it cannot read, with what to do instead', async () => {
    expect((await upload('old.doc', Buffer.from('x'))).data.detail).toContain('save it as .docx')
    expect((await upload('broken.docx', Buffer.from('not a zip'))).status).toBe(415)
    expect((await upload('notes.pdf', Buffer.from('not really a pdf'))).status).toBe(415)
  })
})

describe('PDFs, read by Claude', () => {
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF')
  const upload = (extra: Record<string, unknown> = {}) =>
    req('POST', '/import/file', { filename: 'Corrigans board pack.pdf', data: PDF.toString('base64'), run_now: false, ...extra })

  it('queues the PDF, sends it whole to Claude, keeps the actions and drops the file', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    replies.import = { tasks: [{ title: 'Chase Corrigans for the Q3 tronc sign-off', notes: 'Board pack p4', owner: 'Mandy', priority: 1, due_date: '2026-10-09' }] }
    const { job, tasks } = await read(upload())
    expect(job.status).toBe('done')
    expect(models[0].provider).toBe('anthropic')
    expect(models[0].pdf).toBe(PDF.toString('base64'))
    expect((models[0].payload as any).text).toContain('attached PDF')
    expect(tasks[0]).toMatchObject({ title: 'Chase Corrigans for the Q3 tronc sign-off', priority: 1, due_date: '2026-10-09', source: 'document' })
    expect(tasks[0].notes).toContain('Owner named: Mandy')
    expect(tasks[0].notes).toContain('Imported from a document: Corrigans board pack.')
    expect((await q(`SELECT pdf FROM import_jobs`))[0].pdf).toBeNull()
    expect((await upload()).status).toBe(409)
    expect((await req('GET', '/import')).data.jobs[0]).toMatchObject({ id: job.id, status: 'done' })
  })

  it('streams the request to Anthropic, with the PDF as a document block before the instructions', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    setModelTransport(null) // the real SDK call, answered by the fake fetch
    const text = '{"tasks": [{"title": "Sign off the Q3 tronc"}]}'
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 12 } }],
      ['message_stop', { type: 'message_stop' }],
    ]
    on('POST', /\/v1\/messages$/, () => new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }))
    const { tasks } = await read(upload())
    const sent = hits.find((h) => h.url.hostname === 'api.anthropic.com')!.body
    expect(sent.stream).toBe(true)
    expect(sent.max_tokens).toBe(32000)
    expect(sent.messages[0].content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF.toString('base64') } })
    expect(sent.messages[0].content[1].type).toBe('text')
    expect(tasks.map((t: any) => t.title)).toEqual(['Sign off the Q3 tronc'])
  })

  it('a reply cut off part way keeps every task written in full, and says the rest was not read', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    // The reply that failed in production: fenced JSON, stopped in the middle of a task.
    setModelTransport(async () => '```json\n{"tasks": [\n{"title":"Reconcile Micronet invoice","notes":"","owner":null,"priority":2,"due_date":null},\n'
      + '{"title":"Chase Bentleys {P60s}","notes":"He said \\"Friday\\"","owner":"Mandy","priority":1,"due_date":"2026-10-02"},\n{"titl')
    const { job, tasks } = await read(upload())
    expect(job.status).toBe('done')
    expect(tasks.map((t: any) => t.title)).toEqual(['Reconcile Micronet invoice', 'Chase Bentleys {P60s}'])
    expect(tasks[1].notes).toContain('He said "Friday"')
    expect(job.warning).toContain('the first 2 tasks were imported')
  })

  it('the prompt keeps each task short and does not repeat where it came from', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    replies.import = { tasks: [{ title: 'Reconcile Micronet invoice' }] }
    await read(upload())
    expect(models[0].system).toContain('never say where the task came from')
    expect(models[0].system).toContain('keep every field short')
    expect(models[0].partialOk).toBe(true)
  })

  it('a streamed reply stopped at the token limit is kept in part, not thrown away', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    setModelTransport(null)
    const text = '{"tasks": [{"title": "Sign off the Q3 tronc"}, {"title": "Book the Bentl'
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null }, usage: { output_tokens: 32000 } }],
      ['message_stop', { type: 'message_stop' }],
    ]
    on('POST', /\/v1\/messages$/, () => new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }))
    const { job, tasks } = await read(upload())
    expect(tasks.map((t: any) => t.title)).toEqual(['Sign off the Q3 tronc'])
    expect(job.warning).toContain('too long')
  })

  it('needs the Claude key, and says so before queueing', async () => {
    const r = await upload()
    expect(r.status).toBe(503)
    expect(r.data.detail).toContain('Claude (Anthropic) API key')
    expect(models).toHaveLength(0)
    expect(await q(`SELECT id FROM import_jobs`)).toHaveLength(0)
  })

  it('a failed read ends the job with the reason; no tasks are guessed', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    setModelTransport(async () => { throw new Error('overloaded') })
    const { job } = await read(upload())
    expect(job.status).toBe('failed')
    expect(job.error).toContain('Claude could not read that PDF')
    expect((await req('GET', '/tasks')).data).toHaveLength(0)
  })

  it('a read cut off by the server is picked up again once it is overdue', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    replies.import = { tasks: [{ title: 'Chase the Corrigans board for the Q3 figures' }] }
    const id = (await upload()).data.job.id
    // As if the function was stopped mid-read on its first try.
    await q(`UPDATE import_jobs SET status = 'reading', attempts = 1, started_at = now() - interval '2 minutes' WHERE id = $1`, [id])
    expect((await runImportJobs()).finished).toBe(0) // still within its time: left alone
    await q(`UPDATE import_jobs SET started_at = now() - interval '10 minutes' WHERE id = $1`, [id])
    expect((await runImportJobs()).finished).toBe(1)
    const got = (await req('GET', `/import/jobs/${id}`)).data
    expect([got.job.status, got.job.attempts, got.tasks.length]).toEqual(['done', 2, 1])
  })

  it('a read cut off on both tries is failed with what to do, without a third call to Claude', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const id = (await upload()).data.job.id
    await q(`UPDATE import_jobs SET status = 'reading', attempts = 2, started_at = now() - interval '10 minutes' WHERE id = $1`, [id])
    await runImportJobs()
    const job = (await req('GET', `/import/jobs/${id}`)).data.job
    expect(job.status).toBe('failed')
    expect(job.error).toContain('Split it into smaller parts')
    expect(models).toHaveLength(0)
  })

  it('the background timer finishes a read whose run after the request never started', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    replies.import = { tasks: [{ title: 'Renew the Corrigans engagement letter' }] }
    const r = await upload()
    const { tick } = await import('@/lib/tick')
    const report = await tick()
    expect(report.imports).toBe(1)
    const got = (await req('GET', `/import/jobs/${r.data.job.id}`)).data
    expect(got.job.status).toBe('done')
    expect(got.tasks.map((t: any) => t.title)).toEqual(['Renew the Corrigans engagement letter'])
  })
})

describe('Microsoft To Do', () => {
  const connect = () => q(`INSERT INTO ms_tokens (owner, account, access_token, refresh_token, expires_at) VALUES ('owner', 'owner@example.co', $1, $2, now() + interval '1 hour')`,
    [encrypt('graph-token'), encrypt('refresh')])

  it('imports open tasks from the chosen lists, read only, and skips them the second time', async () => {
    await connect()
    on('GET', /\/me\/todo\/lists$/, () => ({ value: [{ id: 'L1', displayName: 'Tasks', wellknownListName: 'defaultList' }, { id: 'L2', displayName: 'Personal' }] }))
    on('GET', /\/me\/todo\/lists\/L1\/tasks$/, (h) => h.url.searchParams.get('page') === '2'
      ? { value: [{ id: 'T3', title: 'Price the Soho group', status: 'notStarted', importance: 'low' }] }
      : { value: [
        { id: 'T1', title: 'Chase Corrigans tronc', status: 'notStarted', importance: 'high', dueDateTime: { dateTime: '2026-10-03T00:00:00.0000000', timeZone: 'UTC' },
          body: { contentType: 'html', content: '<p>Q3 sign-off &amp; payment</p>' }, checklistItems: [{ displayName: 'Email Sam', isChecked: false }, { displayName: 'Old', isChecked: true }] },
        { id: 'T2', title: 'Done already', status: 'completed' },
      ], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/todo/lists/L1/tasks?page=2' })
    const lists = await req('GET', '/import/todo/lists')
    expect(lists.data.lists.map((l: any) => l.name)).toEqual(['Tasks', 'Personal'])
    const r = await req('POST', '/import/todo', { list_ids: ['L1'], run_now: false })
    expect(r.status).toBe(201)
    expect(r.data.tasks.map((t: any) => [t.title, t.priority, t.due_date, t.source])).toEqual([
      ['Chase Corrigans tronc', 1, '2026-10-03', 'microsoft_todo'], ['Price the Soho group', 3, null, 'microsoft_todo']])
    expect(r.data.tasks[0].notes).toContain('Q3 sign-off & payment')
    expect(r.data.tasks[0].notes).toContain('- Email Sam')
    expect(r.data.tasks[0].notes).not.toContain('Old')
    expect(hits.find((h) => /L1\/tasks$/.test(h.url.pathname))!.url.searchParams.get('$filter')).toBe("status ne 'completed'")
    expect(hits.every((h) => h.method === 'GET')).toBe(true)
    const again = await req('POST', '/import/todo', { list_ids: ['L1'], run_now: false })
    expect([again.data.tasks.length, again.data.skipped]).toEqual([0, 2])
    expect((await req('GET', '/import')).data.microsoft_todo_imported).toBe(2)
  })

  it('says to reconnect when the Tasks permission was not granted', async () => {
    await connect()
    on('GET', /\/me\/todo\/lists$/, () => new Response('{}', { status: 403 }))
    const r = await req('GET', '/import/todo/lists')
    expect(r.status).toBe(403)
    expect(r.data.detail).toContain('Connect Microsoft 365 again')
  })
})

describe('Fireflies', () => {
  const MEETING = { id: 'ff1', title: 'Bentleys monthly', date: Date.UTC(2026, 8, 24, 10), participants: ['sam@bentleys.co'],
    summary: { overview: 'Labour up 2 points.', action_items: '**Mandy**\nChase P60s (04:12)\n**Tom Stanley**\nSend the revised budget (09:40)' } }

  it('lists recent meetings and imports one through the AI, once', async () => {
    await req('PATCH', '/pipeline', {})
    const { saveConfig } = await import('@/lib/config')
    await saveConfig({ fireflies_api_key: 'ff-key' })
    on('POST', /\/graphql$/, (h) => h.body.query.includes('transcripts(') ? { data: { transcripts: [{ ...MEETING, duration: 42.4 }] } } : { data: { transcript: MEETING } })
    replies.import = { tasks: [{ title: 'Chase Bentleys P60s', notes: 'From the monthly', owner: 'Mandy' }, { title: 'Send Bentleys the revised budget', owner: null }] }
    const list = await req('GET', '/import/fireflies')
    expect(list.data.meetings[0]).toMatchObject({ id: 'ff1', title: 'Bentleys monthly', minutes: 42, has_actions: true, imported: false })
    expect(hits[0].headers.Authorization).toBe('Bearer ff-key')
    const r = await req('POST', '/import/fireflies/ff1', { run_now: false })
    expect(r.status).toBe(201)
    expect(r.data.map((t: any) => t.source)).toEqual(['fireflies', 'fireflies'])
    expect(r.data[0].notes).toContain('Owner named: Mandy')
    expect((models[0].payload as any).text).toContain('Send the revised budget')
    expect((models[0].payload as any).text).toContain('Attendees: sam@bentleys.co')
    expect((await req('POST', '/import/fireflies/ff1', { run_now: false })).status).toBe(409)
    expect((await req('GET', '/import/fireflies')).data.meetings[0].imported).toBe(true)
  })

  it('asks for the key when it is missing', async () => {
    const r = await req('GET', '/import/fireflies')
    expect(r.status).toBe(503)
    expect(r.data.detail).toContain('Settings')
  })
})
