import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatcher } from '@/lib/router'
import { mailEndpoints } from '@/lib/email/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { encrypt } from '@/lib/crypto'
import { q } from '@/lib/db'
import { quickRules } from '@/lib/email/triage'
import { sensitiveTopics } from '@/lib/email/drafting'
import { londonToIso } from '@/lib/email/briefs'
import { chunk, index, search } from '@/lib/email/knowledge'
import { dueSlot, runDueJobs } from '@/lib/email/jobs'
import { call } from './helpers'

const api = dispatcher('/api/mail', mailEndpoints)
const req = (method: string, path: string, b?: unknown) => call(api as any, { method, path: `/api/mail${path}`, body: b })

type Hit = { method: string; url: URL; body: any }
let hits: Hit[] = []
let routes: [RegExp, string, (h: Hit) => unknown][] = []

function fakeGraph() {
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
    const url = new URL(input)
    const method = init.method || 'GET'
    const h = { method, url, body: init.body ? JSON.parse(init.body) : null }
    hits.push(h)
    for (const [re, m, fn] of routes) if (m === method && re.test(url.pathname)) return Response.json(fn(h) ?? {})
    return new Response(JSON.stringify({ error: `no fake for ${method} ${url.pathname}` }), { status: 404 })
  }))
}
const on = (method: string, re: RegExp, fn: (h: Hit) => unknown) => routes.push([re, method, fn])

async function connect() {
  await q(`INSERT INTO ms_tokens (owner, account, access_token, refresh_token, expires_at) VALUES ('owner', 'owner@example.co', $1, $2, now() + interval '1 hour')`,
    [encrypt('graph-token'), encrypt('refresh')])
}

const models: ModelCall[] = []
beforeEach(() => {
  hits = []
  routes = []
  models.length = 0
  fakeGraph()
  setModelTransport(async (c) => {
    models.push(c)
    if (c.role === 'triage') return JSON.stringify({ category: 'Important', urgency: 4, confidence: 0.8, reasoning: 'Client deadline', action_required: 'Reply today' })
    if (c.role === 'draft') return 'Hi Sam,\n\nThanks. We will send the VAT figures by Friday, and our feedback on the rota.\n\nBest regards,\nTom'
    if (c.role === 'brief') return 'SNAPSHOT\n- 10:00, 1 hour\nTALKING POINTS\n- Labour %'
    if (c.role === 'summary') return 'Sam asked for the VAT figures; due Friday.'
    return 'text'
  })
})
afterEach(() => setModelTransport(null))

const neverSentOrEdited = () => {
  expect(hits.some((h) => /sendMail|\/send$/.test(h.url.pathname))).toBe(false)
  expect(hits.some((h) => h.method === 'PATCH' && /\/me\/events\//.test(h.url.pathname))).toBe(false)
}

describe('triage rules', () => {
  it('match whole words only', () => {
    expect(quickRules('VAT return due Friday', 'a@b.co')?.category).toBe('Tax')
    expect(quickRules('Clinic booking for staff', 'a@b.co')).toBeNull() // "nic" inside "clinic"
    expect(quickRules('Private dining quote', 'a@b.co')).toBeNull() // "vat" inside "private"
    expect(quickRules('Payslips for September', 'a@b.co')?.category).toBe('Payroll')
    expect(quickRules('Hello', 'no-reply@xero.com')?.category).toBe('Automated')
    expect(quickRules('URGENT: bank details', 'a@b.co')).toMatchObject({ category: 'Urgent', urgency: 4 })
  })

  it('sensitive words are whole words', () => {
    expect(sensitiveTopics('Our feedback for the accountants')).toEqual([])
    expect(sensitiveTopics('Your fee and the VAT payment')).toEqual(['payment', 'fee', 'vat'])
  })
})

describe('email', () => {
  it('needs Microsoft 365 connected, with a clear message', async () => {
    const r = await req('POST', '/triage/run')
    expect(r.status).toBe(401)
    expect(r.data.detail).toContain('not connected to Microsoft 365')
  })

  it('triages new mail once and serves the list from the database', async () => {
    await connect()
    on('GET', /\/me\/mailFolders\/inbox\/messages$/, () => ({ value: [
      { id: 'm1', subject: 'VAT return due', from: { emailAddress: { address: 'sam@client.co', name: 'Sam' } }, receivedDateTime: '2026-09-26T09:00:00Z', bodyPreview: 'Can you...', conversationId: 'c1' },
      { id: 'm2', subject: 'Quick question on the rota', from: { emailAddress: { address: 'gm@venue.co' } }, receivedDateTime: '2026-09-26T10:00:00Z', bodyPreview: 'Hi Tom' },
    ] }))
    const r = await req('POST', '/triage/run')
    expect(r.status).toBe(200)
    expect(r.data.newly_triaged).toBe(2)
    const byId = Object.fromEntries(r.data.triaged_emails.map((e: any) => [e.id, e]))
    expect(byId.m1.triage).toMatchObject({ category: 'Tax', method: 'rules' })
    expect(byId.m2.triage).toMatchObject({ category: 'Important', urgency: 4, method: 'ai' })
    expect(r.data.summary).toEqual({ urgent: 1, important: 1, low_priority: 0 })
    const list = hits.find((h) => h.url.pathname.endsWith('/inbox/messages'))!
    expect(list.url.searchParams.get('$select')).toContain('bodyPreview')
    expect((await req('POST', '/triage/run')).data.newly_triaged).toBe(0) // not triaged twice
    expect((await req('GET', '/emails?filter=urgent')).data.triaged_emails.map((e: any) => e.id)).toEqual(['m2'])
    expect((await search('VAT return')).length).toBeGreaterThan(0) // indexed into knowledge
  })

  it('summarises a thread by conversation id', async () => {
    await connect()
    on('GET', /\/me\/messages\/m1$/, () => ({ id: 'm1', subject: 'VAT', conversationId: "c'1", from: { emailAddress: { address: 'sam@client.co' } } }))
    on('GET', /\/me\/messages$/, () => ({ value: [{ subject: 'VAT', receivedDateTime: '2026-09-25T09:00:00Z', bodyPreview: 'x', from: { emailAddress: { address: 'sam@client.co' } } }] }))
    const r = await req('POST', '/emails/m1/summary')
    expect(r.data.summary).toBe('Sam asked for the VAT figures; due Friday.')
    const listCall = hits.find((h) => h.url.pathname === '/v1.0/me/messages')!
    expect(listCall.url.searchParams.get('$filter')).toBe("conversationId eq 'c''1'")
  })

  it('drafts a threaded reply, tags it, and never sends', async () => {
    await connect()
    on('GET', /\/me\/messages\/m1$/, () => ({ id: 'm1', subject: 'VAT', from: { emailAddress: { address: 'sam@client.co', name: 'Sam' } }, body: { content: 'Need VAT by Friday' } }))
    on('POST', /\/me\/messages\/m1\/createReply$/, () => ({ id: 'd1', webLink: 'https://outlook/d1', subject: 'RE: VAT' }))
    on('PATCH', /\/me\/messages\/d1$/, () => ({}))
    const r = await req('POST', '/draft/smart-reply', { email_id: 'm1' })
    expect(r.status).toBe(200)
    expect(r.data).toMatchObject({ success: true, draft_id: 'd1', draft_link: 'https://outlook/d1', sensitive_topics: ['vat'] })
    expect(hits.find((h) => h.url.pathname.endsWith('/createReply'))!.body.comment).toContain('Best regards,\nTom')
    expect(hits.find((h) => h.method === 'PATCH')!.body).toEqual({ categories: ['Drafted by Aimelia'] })
    const draftCall = models.find((m) => m.role === 'draft')!
    expect(draftCall.system).toContain('Williams, Stanley & Co') // the persona, not the fallback
    expect(draftCall.messages.at(-1)!.content).toContain('120-180 words')
    neverSentOrEdited()
  })

  it('checks the draft request', async () => {
    expect((await req('POST', '/draft/smart-reply', {})).status).toBe(422)
    const t = await req('POST', '/draft/test', { subject: 'VAT', body: 'Need it' })
    expect(t.data).toMatchObject({ success: true, meets_requirements: false })
  })
})

describe('meetings', () => {
  it('prepares briefs, keeps them in Aimelia, and leaves calendar events alone', async () => {
    await connect()
    on('GET', /\/me\/calendarView$/, () => ({ value: [
      { id: 'e1', subject: 'Bentleys Q3 review', start: { dateTime: '2026-09-28T10:00:00.0000000' }, end: { dateTime: '2026-09-28T11:00:00.0000000' },
        attendees: [{ emailAddress: { address: 'gm@bentleys.co', name: 'GM' } }], location: { displayName: 'Soho' } },
      { id: 'e2', subject: 'Bank holiday', isAllDay: true, start: { dateTime: '2026-09-28T00:00:00' }, end: { dateTime: '2026-09-29T00:00:00' } },
    ] }))
    on('GET', /\/me\/events\/e1$/, () => ({ id: 'e1', subject: 'Bentleys Q3 review', start: { dateTime: '2026-09-28T10:00:00.0000000' }, end: { dateTime: '2026-09-28T11:00:00.0000000' },
      attendees: [{ emailAddress: { address: 'gm@bentleys.co', name: 'GM' } }], location: { displayName: 'Soho' } }))
    on('GET', /\/me\/messages$/, () => ({ value: [{ subject: 'Labour %', from: { emailAddress: { address: 'gm@bentleys.co' } }, receivedDateTime: '2026-09-25T09:00:00Z', bodyPreview: 'Worried' }] }))
    const r = await req('POST', '/prep/next24h')
    expect(r.data).toMatchObject({ total_meetings: 1, meetings_prepared: 1, errors: [] })
    expect(r.data.prepared_meetings[0].brief).toContain('Prepared by Aimelia')
    expect(r.data.prepared_meetings[0].start_time).toBe('2026-09-28T09:00:00.000Z') // 10:00 BST
    const comms = hits.find((h) => h.url.pathname === '/v1.0/me/messages')!
    expect(comms.url.searchParams.get('$filter')).toBe("from/emailAddress/address eq 'gm@bentleys.co'")
    expect(comms.url.searchParams.get('$orderby')).toBeNull() // Graph rejects $filter with $orderby here
    expect(hits.find((h) => h.url.pathname.endsWith('/calendarView'))!.url.searchParams.get('startDateTime')).toMatch(/Z$/)
    expect((await req('POST', '/prep/next24h')).data.meetings_prepared).toBe(0) // already prepared
    neverSentOrEdited()
  })

  it('converts London wall-clock time in summer and winter', () => {
    expect(londonToIso('2026-07-01T10:00:00.0000000')).toBe('2026-07-01T09:00:00.000Z')
    expect(londonToIso('2026-12-01T10:00:00')).toBe('2026-12-01T10:00:00.000Z')
  })
})

describe('knowledge', () => {
  it('chunks, stores, searches and deletes', async () => {
    const words = Array.from({ length: 2500 }, (_, i) => `w${i}`).join(' ')
    expect(chunk(words).length).toBe(3)
    const r = await req('POST', '/knowledge', { title: 'Tronc policy', text: 'Service charge and tronc are shared under the 2023 Act. The troncmaster allocates.', source: 'policy' })
    expect(r.status).toBe(201)
    const found = (await req('GET', '/knowledge?q=tronc allocation')).data.results
    expect(found[0].title).toBe('Tronc policy')
    expect((await req('DELETE', `/knowledge/${found[0].id}`)).status).toBe(204)
    await index('document', 'x', 'Empty', '')
    expect((await req('GET', '/knowledge')).data.results).toHaveLength(0)
  })
})

describe('automation', () => {
  it('runs each job once per slot, only when connected', async () => {
    expect(dueSlot('triage', new Date('2026-09-28T08:15:00Z'))).toBe('2026-09-28T09') // 09:15 BST
    expect(dueSlot('briefs', new Date('2026-09-28T04:00:00Z'))).toBeNull() // 05:00 BST
    expect(dueSlot('briefs', new Date('2026-09-28T05:30:00Z'))).toBe('2026-09-28T06')
    expect(dueSlot('briefs', new Date('2026-09-28T17:30:00Z'))).toBe('2026-09-28T18')
    expect(await runDueJobs()).toBe('Microsoft 365 not connected')
    await connect()
    on('GET', /\/inbox\/messages$/, () => ({ value: [] }))
    on('GET', /\/me\/calendarView$/, () => ({ value: [] }))
    const at = new Date('2026-09-28T06:10:00Z')
    const first: any = await runDueJobs(at)
    expect(first.triage).toMatchObject({ fetched: 0, triaged: 0 })
    expect(first.briefs).toMatchObject({ total_meetings: 0 })
    expect(await runDueJobs(at)).toEqual({}) // same slot: nothing again
    const status = (await req('GET', '/jobs')).data
    expect(status.jobs.map((j: any) => j.id).sort()).toEqual(['briefs', 'triage'])
    expect(status.logs.length).toBe(2)
    await req('PATCH', '/jobs/triage', { enabled: false, auto_draft: true })
    const triage = (await req('GET', '/jobs')).data.jobs.find((j: any) => j.id === 'triage')
    expect([triage.enabled, triage.options.auto_draft]).toEqual([false, true])
  })

  it('reports real figures', async () => {
    await q(`INSERT INTO emails (graph_id, subject, category, urgency, method, confidence, received_at) VALUES
      ('a','x','Tax',3,'rules',0.9, now()), ('b','y','Important',4,'ai',0.8, now()), ('c','z','Important',5,'ai',0.6, now())`)
    const a = (await req('GET', '/analytics')).data
    expect(a.totals).toMatchObject({ emails: 3, urgent: 2 })
    expect(a.by_category[0]).toEqual({ category: 'Important', n: 2 })
    expect(Math.round(a.totals.ai_confidence * 10)).toBe(7)
  })
})
