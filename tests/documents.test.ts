import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { processQueue } from '@/lib/agents/orchestrator'
import { readTaskFiles } from '@/lib/agents/documents'
import { one, q } from '@/lib/db'
import { call } from './helpers'

const api = dispatcher('/api/todo', todoEndpoints)
const req = (method: string, path: string, b?: unknown) => call(api as any, { method, path: `/api/todo${path}`, body: b })

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF')
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const b64 = (b: Buffer) => b.toString('base64')

/** A minimal .docx holding one paragraph. */
function docx(text: string): Buffer {
  const name = Buffer.from('word/document.xml')
  const raw = Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)
  const data = deflateRawSync(raw)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16)
  return Buffer.concat([local, name, data, central, name, end])
}

const ASSESSMENT = {
  summary: 'The firm AML policy, dated March 2021, owned by the MLRO. Sound structure but out of date in places.',
  overall: 'needs work',
  sections: [{ ref: '3', title: 'Customer due diligence', says: 'CDD before engagement.' }],
  findings: [
    { ref: '3.2', rating: 'RED', finding: 'No enhanced due diligence for high-risk third countries.', requirement: 'MLR 2017 reg 33', change: 'Add an EDD procedure.' },
    { ref: '5', rating: 'amber', finding: 'Training frequency not stated.', requirement: 'MLR 2017 reg 24', change: 'State annual training.' },
    { ref: '1', rating: 'purple', finding: 'Ownership is clear.', requirement: '', change: '' },
    { ref: '9', rating: 'green', finding: '', requirement: '', change: '' },
  ],
  missing: ['A firm-wide risk assessment reference'],
  questions: ['Who is the deputy MLRO?'],
}

let replies: Record<string, unknown[]> = {}
const calls: ModelCall[] = []
beforeEach(() => {
  setLaterHook(() => {})
  replies = {}
  calls.length = 0
  setModelTransport(async (c) => {
    calls.push(c)
    const list = replies[c.role] || []
    const next = list.length > 1 ? list.shift() : list[0]
    if (next instanceof Error) throw next
    return JSON.stringify(next ?? {})
  })
})
afterEach(() => { setModelTransport(null); setLaterHook(null) })

const approve = { verdict: 'approve', score: 9, feedback: '', action_feedback: [], questions: [] }
async function amlTask() {
  return (await req('POST', '/tasks', { title: 'Review our AML policy', notes: 'Annual review before the ICAEW visit', run_now: false })).data
}
const attach = (id: string, files: { name: string; data: string }[], extra: Record<string, unknown> = {}) =>
  req('POST', `/tasks/${id}/files`, { files, run_now: false, ...extra })

describe('documents on a task', () => {
  it('a PDF is read and assessed once by Claude, and the task waits for it', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const t = await amlTask()
    await q(`UPDATE tasks SET status = 'done' WHERE id = $1`, [t.id]) // attaching to a closed task opens it again
    const r = await attach(t.id, [{ name: 'AML policy 2021.pdf', data: b64(PDF) }], { purpose: 'MLR 2017 and ICAEW requirements' })
    expect(r.status).toBe(201)
    expect(r.data.files[0]).toMatchObject({ name: 'AML policy 2021.pdf', kind: 'pdf', status: 'reading', purpose: 'MLR 2017 and ICAEW requirements' })
    expect(r.data.files[0].data).toBeUndefined()
    expect(r.data.task.status).toBe('queued')

    replies.worker = [{ summary: 'worked', actions: [{ kind: 'document', title: 'AML policy assessment', content: 'RAG table', details: {} }] }]
    replies.reviewer = [approve]
    expect(await processQueue()).toBe(0) // waits while the document is being read
    expect(calls.filter((c) => c.role === 'worker')).toHaveLength(0)

    replies.document = [ASSESSMENT]
    expect(await readTaskFiles()).toBe(1)
    const read = calls.find((c) => c.role === 'document')!
    expect([read.provider, read.pdf]).toEqual(['anthropic', b64(PDF)])
    expect(read.system).toContain('Money Laundering, Terrorist Financing and Transfer of Funds')
    expect(read.system).toContain('check the current wording')
    expect(JSON.parse(read.messages[0].content)).toMatchObject({ document: 'AML policy 2021.pdf', check_it_against: 'MLR 2017 and ICAEW requirements', task: { title: 'Review our AML policy' } })

    const file = (await req('GET', `/tasks/${t.id}`)).data.files[0]
    expect(file.status).toBe('ready')
    expect(file.reading.overall).toBe('needs work')
    expect(file.reading.findings.map((f: any) => [f.ref, f.rating])).toEqual([['3.2', 'red'], ['5', 'amber'], ['1', 'amber']]) // unknown ratings read as amber; empty findings dropped

    expect(await processQueue()).toBe(1)
    const worker = calls.find((c) => c.role === 'worker')!.payload as any
    expect(worker.documents[0]).toMatchObject({ name: 'AML policy 2021.pdf', check_it_against: 'MLR 2017 and ICAEW requirements', overall: 'needs work' })
    expect(worker.documents[0].findings[0].requirement).toBe('MLR 2017 reg 33')
    expect(worker.documents[0].full_text).toBeUndefined() // agents work from the assessment, not the pages
    expect(worker.how_to_use_the_documents).toContain('red and amber finding')
    expect(calls.filter((c) => c.role === 'worker').every((c) => !c.pdf)).toBe(true)
    expect((await req('GET', `/tasks/${t.id}`)).data.status).toBe('ready')
  })

  it('a Word document is read as text, needs no Claude key, and the agents get its full text too', async () => {
    const t = await amlTask()
    replies.document = [{ ...ASSESSMENT, overall: 'sound' }]
    const r = await attach(t.id, [{ name: 'Client risk assessment procedure.docx', data: b64(docx('All new clients are risk rated before engagement.')) }])
    expect(r.data.files[0].kind).toBe('text')
    await readTaskFiles()
    const read = calls.find((c) => c.role === 'document')!
    expect([read.provider, read.pdf]).toEqual(['mock', undefined]) // 'auto' with no key set: not forced to Claude
    expect(read.messages[0].content).toContain('All new clients are risk rated before engagement.')
    replies.worker = [{ summary: 'ok', actions: [{ kind: 'note', title: 'x', content: 'y', details: {} }] }]
    replies.reviewer = [approve]
    await processQueue()
    expect((calls.find((c) => c.role === 'worker')!.payload as any).documents[0].full_text).toContain('risk rated before engagement')
  })

  it('a photo of paperwork goes to Claude as an image', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const t = await amlTask()
    await attach(t.id, [{ name: 'signed page.png', data: b64(PNG) }])
    replies.document = [ASSESSMENT]
    await readTaskFiles()
    const read = calls.find((c) => c.role === 'document')!
    expect(read.messages[0].files?.[0]).toMatchObject({ kind: 'image', media_type: 'image/png', name: 'signed page.png' })
  })

  it('PDFs and photos need the Claude key; Word does not', async () => {
    const t = await amlTask()
    const r = await attach(t.id, [{ name: 'policy.pdf', data: b64(PDF) }])
    expect(r.status).toBe(503)
    expect(r.data.detail).toContain('Claude (Anthropic) API key')
    expect(await q(`SELECT id FROM task_files`)).toHaveLength(0)
  })

  it('refuses what it cannot read, and more than ten documents on a task', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const t = await amlTask()
    expect((await attach(t.id, [{ name: 'policy.pdf', data: b64(Buffer.from('not a pdf')) }])).status).toBe(422)
    expect((await attach(t.id, [{ name: 'old.doc', data: b64(Buffer.from('x')) }])).status).toBe(422)
    for (let i = 0; i < 2; i++) await attach(t.id, Array.from({ length: 5 }, (_, n) => ({ name: `p${i}${n}.pdf`, data: b64(PDF) })))
    const r = await attach(t.id, [{ name: 'eleventh.pdf', data: b64(PDF) }])
    expect(r.status).toBe(422)
    expect(r.data.detail).toContain('10 documents')
  })

  it('a read that fails is tried once more, then the team is told it could not be read', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const t = await amlTask()
    await attach(t.id, [{ name: 'scan.pdf', data: b64(PDF) }])
    replies.document = [new Error('overloaded')]
    await readTaskFiles()
    let f = (await req('GET', `/tasks/${t.id}`)).data.files[0]
    expect([f.status, f.error]).toEqual(['reading', expect.stringContaining('overloaded')])
    await readTaskFiles()
    expect(calls.filter((c) => c.role === 'document')).toHaveLength(1) // not straight away
    await q(`UPDATE task_files SET claimed_at = now() - interval '8 minutes'`)
    await readTaskFiles()
    f = (await req('GET', `/tasks/${t.id}`)).data.files[0]
    expect(f.status).toBe('failed')
    expect(f.error).toContain('Claude could not read scan.pdf')
    replies.worker = [{ summary: 'ok', actions: [{ kind: 'note', title: 'x', content: 'y', details: {} }] }]
    replies.reviewer = [approve]
    expect(await processQueue()).toBe(1)
    expect((calls.find((c) => c.role === 'worker')!.payload as any).documents[0]).toEqual({ name: 'scan.pdf', could_not_be_read: expect.stringContaining('overloaded') })
  })

  it('can be kept in the knowledge base; removing the document removes it there too', async () => {
    const t = await amlTask()
    const r = await attach(t.id, [{ name: 'AML policy.docx', data: b64(docx('The MLRO is Tom Stanley.')) }], { keep_in_knowledge: true })
    replies.document = [ASSESSMENT]
    await readTaskFiles()
    const kb = await q(`SELECT source, title, chunk FROM kb_chunks`)
    expect(kb[0]).toMatchObject({ source: 'policy', title: 'AML policy.docx' })
    expect(kb[0].chunk).toContain('The MLRO is Tom Stanley.')
    expect((await req('DELETE', `/tasks/${t.id}/files/${r.data.files[0].id}`)).status).toBe(204)
    expect(await q(`SELECT id FROM kb_chunks`)).toHaveLength(0)
    expect((await req('GET', `/tasks/${t.id}`)).data.files).toEqual([])
  })

  it('the file can be opened again as it was sent, and only from its own task', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const t = await amlTask()
    const other = await amlTask()
    const f = (await attach(t.id, [{ name: 'AML policy.pdf', data: b64(PDF) }])).data.files[0]
    const got = await req('GET', `/tasks/${t.id}/files/${f.id}`)
    expect(got.headers.get('content-type')).toBe('application/pdf')
    expect(got.headers.get('content-disposition')).toContain('attachment')
    expect((await req('GET', `/tasks/${other.id}/files/${f.id}`)).status).toBe(404)
  })

  it('the event log records what was attached, read and removed', async () => {
    const t = await amlTask()
    const f = (await attach(t.id, [{ name: 'policy.docx', data: b64(docx('text')) }], { purpose: 'MLR 2017' })).data.files[0]
    replies.document = [ASSESSMENT]
    await readTaskFiles()
    await req('DELETE', `/tasks/${t.id}/files/${f.id}`)
    const ev = (await one(`SELECT json_agg(content ORDER BY created_at) AS c FROM events WHERE task_id = $1 AND kind = 'documents'`, [t.id]))!.c
    expect(ev).toEqual([{ attached: ['policy.docx'], check_against: 'MLR 2017' }, { read: 'policy.docx', overall: 'needs work' }, { removed: 'policy.docx' }])
  })
})

describe('files given with an answer to a question', () => {
  async function asked(title: string, question: string) {
    replies.worker = [{ summary: 'blocked', actions: null, questions: [{ question, why: '' }] }]
    replies.reviewer = [approve]
    const t = (await req('POST', '/tasks', { title, run_now: false })).data
    await processQueue()
    const d = (await req('GET', `/tasks/${t.id}`)).data
    expect(d.status).toBe('needs_input')
    return { t, qn: d.questions[0] }
  }

  it('a screenshot and a pasted chat answer the question; Claude reads them for what they show, and the team gets it', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const { t, qn } = await asked('Corrigans tronc sign-off', 'Who signed off the Q3 tronc allocation?')
    expect((await req('POST', `/questions/${qn.id}/answer`, { answer: '' })).status).toBe(422)

    const r = await req('POST', `/questions/${qn.id}/files`, { files: [
      { name: 'Screenshot 10.14.png', data: b64(PNG) },
      { name: 'Claude chat.md', data: b64(Buffer.from('Tom: who approved it?\nClaude: Jo Hart approved the Q3 tronc allocation on 12 September.')) },
    ] })
    expect(r.status).toBe(201)
    expect(r.data.files.map((f: any) => [f.role, f.question_id, f.status])).toEqual([['evidence', qn.id, 'reading'], ['evidence', qn.id, 'reading']])
    expect((await one(`SELECT status FROM tasks WHERE id = $1`, [t.id]))!.status).toBe('needs_input') // the files wait for the answer

    const a = (await req('POST', `/questions/${qn.id}/answer`, { answer: '' })).data
    expect(a).toMatchObject({ task_resumed: true, files: 2 })
    expect(a.question.answer).toBe('(Attached: Screenshot 10.14.png, Claude chat.md)')

    // The team waits for the reads.
    replies.document = [{ summary: 'A screenshot of the tronc schedule.', answer: 'Jo Hart signed it off on 12 September.', facts: ['Signed off by Jo Hart', '12 September 2026'], open: [] }]
    await processQueue()
    expect(calls.filter((c) => c.role === 'worker')).toHaveLength(2) // only the first run, before the answer
    await readTaskFiles()
    const read = calls.filter((c) => c.role === 'document')
    expect(read).toHaveLength(2)
    expect(read[0].system).toContain('gave this file as part of his answer')
    expect((read[0].payload as any).question_tom_was_answering).toBe('Who signed off the Q3 tronc allocation?')

    replies.worker = [{ summary: 'done', actions: [{ kind: 'note', title: 'Noted', content: 'Jo Hart', details: {} }] }]
    await processQueue()
    const ctx: any = calls.filter((c) => c.role === 'worker').at(-1)!.payload
    expect(ctx.files_tom_gave_with_his_answers.map((f: any) => [f.name, f.in_answer_to, f.what_it_shows])).toEqual([
      ['Screenshot 10.14.png', 'Who signed off the Q3 tronc allocation?', 'Jo Hart signed it off on 12 September.'],
      ['Claude chat.md', 'Who signed off the Q3 tronc allocation?', 'Jo Hart signed it off on 12 September.'],
    ])
    expect(ctx.files_tom_gave_with_his_answers[1].full_text).toContain('Jo Hart approved')
    expect(ctx.documents).toBeUndefined() // not treated as documents to assess
    const got = (await req('GET', `/tasks/${t.id}`)).data
    expect(got.files.map((f: any) => f.reading?.facts?.[0])).toEqual(['Signed off by Jo Hart', 'Signed off by Jo Hart'])
  })

  it('files on a question shared by two tasks go to both, and words and files can be sent together', async () => {
    const a = await asked('Corrigans year-end pack', 'Who is the FD at Corrigans?')
    const b = await asked('Corrigans tronc', 'Who is the Corrigans FD?')
    await q(`UPDATE questions SET status = 'merged', merged_into = $2 WHERE id = $1`, [b.qn.id, a.qn.id])
    await req('POST', `/questions/${b.qn.id}/files`, { files: [{ name: 'org chart.txt', data: b64(Buffer.from('FD: Jo Hart')) }] })
    const n = await q(`SELECT task_id FROM task_files WHERE question_id = $1 ORDER BY task_id`, [a.qn.id])
    expect(n.map((r) => r.task_id).sort()).toEqual([a.t.id, b.t.id].sort())
    const r = (await req('POST', `/questions/${a.qn.id}/answer`, { answer: 'Jo Hart' })).data
    expect(r).toMatchObject({ tasks_resumed: 2, files: 1 })
    expect(r.question.answer).toBe('Jo Hart (Attached: org chart.txt)')
    expect((await req('POST', `/questions/${a.qn.id}/files`, { files: [{ name: 'x.txt', data: b64(Buffer.from('x')) }] })).status).toBe(409)
  })
})
