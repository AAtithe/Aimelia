import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { setModelTransport, parseJson, LLMError, type ModelCall } from '@/lib/llm'
import { processQueue, seedDefaults } from '@/lib/agents/orchestrator'
import { createDueRoutines, firstDue, nextAfter, nudgeStale, wakeScheduled } from '@/lib/agents/schedule'
import { lessonsForContext } from '@/lib/agents/lessons'
import { dueNow } from '@/lib/agents/notify'
import { findSlot } from '@/lib/agents/calendarBlocks'
import { compact, lookup } from '@/lib/agents/sources'
import { addDays, londonToday } from '@/lib/dates'
import { one, q } from '@/lib/db'
import { call } from './helpers'

const api = dispatcher('/api/todo', todoEndpoints)
const req = (method: string, path: string, b?: unknown, headers?: Record<string, string>) =>
  call(api as any, { method, path: `/api/todo${path}`, body: b, headers })

class Scripted {
  calls: (ModelCall & { agent?: string })[] = []
  replies: Record<string, unknown[]>
  constructor(r: { worker?: unknown[]; reviewer?: unknown[]; other?: Record<string, unknown> } = {}) {
    this.replies = { worker: r.worker || [], reviewer: r.reviewer || [], ...(r.other || {}) }
  }
  transport = async (c: ModelCall) => {
    this.calls.push({ ...c, agent: (c.payload as any)?.you_are })
    const queue = this.replies[c.role]
    const next = Array.isArray(queue) ? (queue.length > 1 ? queue.shift() : queue[0]) : queue
    if (next instanceof Error) throw next
    return JSON.stringify(next ?? {})
  }
  roles = () => this.calls.map((c) => c.role)
}
const use = (s: Scripted) => { setModelTransport(s.transport); return s }

const action = (title = 'Email to supplier', kind = 'email_draft') => ({ kind, title, content: 'Body', details: { to: 'a@b.com', subject: 'Hi' } })
const approve = (score = 9) => ({ verdict: 'approve', score, feedback: '', action_feedback: [], questions: [] })
const revise = (msg = 'Tighten it') => ({ verdict: 'revise', score: 4, feedback: msg, action_feedback: [{ index: 0, note: msg }], questions: [] })

async function create(extra: Record<string, unknown> = {}) {
  const r = await req('POST', '/tasks', { title: 'Renegotiate linen contract', notes: 'Current 2.1k pm', run_now: false, ...extra })
  expect(r.status).toBe(201)
  return r.data
}
const get = async (id: string) => (await req('GET', `/tasks/${id}`)).data

beforeEach(() => { setLaterHook(() => {}) })
afterEach(() => { setModelTransport(null); setLaterHook(null) })

describe('access and seeding', () => {
  it('needs the key', async () => {
    expect((await req('GET', '/tasks', undefined, {})).status).toBe(401)
    expect((await req('GET', '/tasks', undefined, { 'x-aimelia-key': 'wrong' })).status).toBe(401)
    expect((await req('GET', '/tasks')).status).toBe(200)
    expect((await req('GET', '/nope')).status).toBe(404)
  })

  it('seeds the default team', async () => {
    const d = (await req('GET', '/agents')).data
    const byName = Object.fromEntries(d.agents.map((a: any) => [a.name, a]))
    expect(Object.keys(byName).sort()).toEqual(['Chief of Staff', 'Hospitality Finance Specialist', 'Planner', 'Reviewer', 'Triage'])
    expect(byName.Reviewer.role).toBe('reviewer')
    expect(byName.Triage.can_ask_questions).toBe(false)
    expect(byName['Hospitality Finance Specialist'].enabled).toBe(false)
    expect(byName.Planner.resolved_provider).toBe('mock')
    expect(d.pipeline.house_rules).toContain('No emojis')
  })

  it('offers new default agents to an existing team once, never reviving deleted ones', async () => {
    await q(`INSERT INTO pipeline (id, defaults_version) VALUES (1, 0)`)
    await q(`INSERT INTO agents (name, role, instructions, position) VALUES ('Chief of Staff', 'worker', 'x', 0), ('Reviewer', 'reviewer', 'x', 0)`)
    let names = (await req('GET', '/agents')).data.agents.map((a: any) => a.name)
    expect(names).toContain('Triage')
    expect(names).not.toContain('Planner')
    const workers = (await req('GET', '/agents')).data.agents.filter((a: any) => a.role === 'worker')
    expect(workers[0].name).toBe('Triage')
    await req('DELETE', `/agents/${workers[0].id}`)
    names = (await req('GET', '/agents')).data.agents.map((a: any) => a.name)
    expect(names).not.toContain('Triage')
  })
})

describe('the run loop', () => {
  it('runs workers in order then the reviewer', async () => {
    const s = use(new Scripted({ worker: [{ summary: 'DO', actions: null }, { summary: 'planned', actions: [action('Plan', 'checklist')] }, { summary: 'done', actions: [action()] }], reviewer: [approve()] }))
    const t = await create()
    await processQueue()
    const got = await get(t.id)
    expect(got.status).toBe('ready')
    expect(got.actions.map((a: any) => a.title)).toEqual(['Email to supplier'])
    expect(got.actions[0].review_status).toBe('approved')
    expect(s.calls.slice(0, 3).map((c) => c.agent)).toEqual(['Triage', 'Planner', 'Chief of Staff'])
    expect(s.roles()).toEqual(['worker', 'worker', 'worker', 'reviewer'])
    expect((s.calls[2].payload as any).draft_actions[0].title).toBe('Plan')
    expect(s.calls[0].system).toContain('House rules')
    expect(s.calls[0].system).toContain('"actions"')
    const brief = (await req('GET', '/briefing')).data
    expect(brief.counts.ready).toBe(1)
    expect(brief.actions[0].task_title).toBe('Renegotiate linen contract')
  })

  it('sends work back with the reviewer feedback', async () => {
    const s = use(new Scripted({ worker: [{ summary: 'v', actions: [action()] }], reviewer: [revise('Add the notice period'), approve()] }))
    const t = await create()
    await processQueue()
    expect(s.roles()).toEqual([...Array(3).fill('worker'), 'reviewer', ...Array(3).fill('worker'), 'reviewer'])
    expect((s.calls[4].payload as any).reviewer_feedback.reviews[0].feedback).toBe('Add the notice period')
    const got = await get(t.id)
    expect(got.status).toBe('ready')
    expect(got.review_flag).toBeNull()
  })

  it('flags work the reviewer never approves, and a low score is not approval', async () => {
    use(new Scripted({ worker: [{ summary: 'v', actions: [action()] }], reviewer: [revise()] }))
    await req('PATCH', '/pipeline', { max_revisions: 1 })
    const t = await create()
    await processQueue()
    const got = await get(t.id)
    expect(got.review_flag).toMatch(/^Reviewer did not approve/)
    expect(got.actions[0].review_status).toBe('flagged')

    use(new Scripted({ worker: [{ summary: 'v', actions: [action()] }], reviewer: [approve(5)] }))
    await req('PATCH', '/pipeline', { max_revisions: 0, approval_threshold: 7 })
    const t2 = await create()
    await processQueue()
    expect((await get(t2.id)).actions[0].review_status).toBe('flagged')
  })

  it('pauses for questions and resumes when answered', async () => {
    const s = use(new Scripted({ worker: [{ summary: 'blocked', actions: null, questions: [{ question: 'Who is the supplier?', why: 'Need recipient' }] }], reviewer: [approve()] }))
    const t = await create()
    await processQueue()
    expect((await get(t.id)).status).toBe('needs_input')
    expect(s.calls.map((c) => c.agent)).toEqual(['Triage', 'Planner'])
    const brief = (await req('GET', '/briefing')).data
    expect(brief.questions[0].question).toBe('Who is the supplier?')
    s.replies.worker = [{ summary: 'ok', actions: [action()] }]
    const r = await req('POST', `/questions/${brief.questions[0].id}/answer`, { answer: 'Johnsons' })
    expect(r.data.task_resumed).toBe(true)
    await processQueue()
    expect((await get(t.id)).status).toBe('ready')
    const last = s.calls.filter((c) => c.role === 'worker').at(-1)!
    expect((last.payload as any).answered_questions).toEqual([{ question: 'Who is the supplier?', answer: 'Johnsons' }])
  })

  it('does not loop on a repeated question', async () => {
    use(new Scripted({ worker: [{ summary: '', actions: null, questions: [{ question: 'Who is the supplier?' }] }], reviewer: [approve()] }))
    const t = await create()
    await processQueue()
    const qid = (await get(t.id)).questions[0].id
    await req('POST', `/questions/${qid}/answer`, { answer: 'Johnsons' })
    await processQueue()
    const got = await get(t.id)
    expect(got.status).toBe('failed')
    expect(got.events.some((e: any) => e.kind === 'error')).toBe(true)
  })

  it('an agent without permission cannot block', async () => {
    const s = use(new Scripted({ worker: [{ summary: 'v', actions: [action()], questions: [{ question: 'Anything?' }] }], reviewer: [approve()] }))
    for (const a of (await req('GET', '/agents')).data.agents) await req('PATCH', `/agents/${a.id}`, { can_ask_questions: false })
    const t = await create()
    await processQueue()
    expect((await get(t.id)).status).toBe('ready')
    expect(s.calls[0].system).toContain('You may not ask questions')
  })

  it('runs a custom team', async () => {
    const s = use(new Scripted({ worker: [{ summary: 'v', actions: [action()] }], reviewer: [approve()] }))
    const r = await req('POST', '/agents', { name: 'Legal Checker', role: 'reviewer', instructions: 'Check contracts.', provider: 'anthropic', model: 'claude-opus-5-5' })
    expect(r.status).toBe(201)
    expect(r.data.resolved_model).toBe('claude-opus-5-5')
    const planner = (await req('GET', '/agents')).data.agents.find((a: any) => a.name === 'Planner')
    await req('PATCH', `/agents/${planner.id}`, { enabled: false })
    await create()
    await processQueue()
    expect(s.calls.slice(0, 2).map((c) => c.agent)).toEqual(['Triage', 'Chief of Staff'])
    expect(s.roles().filter((x) => x === 'reviewer')).toHaveLength(2)
  })

  it('approve, reject with rework, feedback, done', async () => {
    const s = use(new Scripted({ worker: [{ summary: 'v', actions: [action('A'), action('B')] }], reviewer: [approve()] }))
    const t = await create()
    await processQueue()
    const [a, b] = (await get(t.id)).actions
    expect((await req('POST', `/actions/${a.id}/approve`, {})).data.task_status).toBe('ready')
    expect((await req('POST', `/actions/${b.id}/reject`, { reason: 'Too long', rework: true })).data.task_status).toBe('queued')
    await processQueue()
    const ctx: any = s.calls.at(-2)!.payload
    expect(ctx.tom_feedback).toContain("Rejected 'B'. Too long")
    expect(ctx.previous_actions).toContainEqual({ title: 'A', kind: 'email_draft', status: 'approved', tom_feedback: null })
    const live = (await get(t.id)).actions.filter((x: any) => x.status === 'proposed')
    expect(live).toHaveLength(2)
    for (const x of live) await req('POST', `/actions/${x.id}/done`)
    expect((await get(t.id)).status).toBe('done')
  })

  it('records a failed run on the task', async () => {
    use(new Scripted({ worker: [new LLMError('rate limited')] }))
    const t = await create()
    await processQueue()
    const got = await get(t.id)
    expect(got.status).toBe('failed')
    expect(got.events.at(-1).content.error).toBe('rate limited')
    expect((await req('POST', `/tasks/${t.id}/run`)).data.status).toBe('queued')
  })

  it('works end to end on the placeholder model', async () => {
    const t = await create({ notes: '' })
    await processQueue()
    const got = await get(t.id)
    expect(got.status).toBe('needs_input')
    await req('POST', `/questions/${got.questions[0].id}/answer`, { answer: 'Save 15%' })
    await processQueue()
    expect((await get(t.id)).status).toBe('ready')
  })

  it('parses JSON wrapped in prose or fences', () => {
    expect(parseJson('Sure:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(parseJson('prefix {"a": {"b": 2}} suffix')).toEqual({ a: { b: 2 } })
    expect(() => parseJson('no json')).toThrow(LLMError)
  })
})

describe('triage and capture', () => {
  it('delegation uses the team directory', async () => {
    const handover = { kind: 'delegate', title: 'Hand to Mandy: chase P60s', content: 'Mandy, please own this.', details: { owner: 'Mandy', due: '2026-10-02' } }
    const s = use(new Scripted({ worker: [{ summary: 'DELEGATE to Mandy', actions: [handover] }, { summary: 'kept', actions: null }], reviewer: [approve()] }))
    await req('PATCH', '/pipeline', { team_directory: 'Mandy, Payroll Manager, payroll runs' })
    const t = await create({ title: 'Chase P60s' })
    await processQueue()
    expect((s.calls[0].payload as any).team_directory).toBe('Mandy, Payroll Manager, payroll runs')
    const got = await get(t.id)
    expect(got.actions[0].kind).toBe('delegate')
    expect(got.actions[0].details.owner).toBe('Mandy')
  })

  it('splits a brain dump into clean tasks', async () => {
    use(new Scripted({ other: { capture: [{ tasks: [{ title: 'Sign off Corrigans tronc', notes: 'Q3', priority: 1, due_date: '2026-10-01' }, { title: '', notes: 'junk' }, { title: 'Book Bentleys review', priority: 'x', due_date: 'next week' }] }] } }))
    const r = await req('POST', '/capture', { text: 'tronc corrigans, bentleys review', run_now: false })
    expect(r.status).toBe(201)
    expect(r.data.map((t: any) => t.title)).toEqual(['Sign off Corrigans tronc', 'Book Bentleys review'])
    expect([r.data[0].priority, r.data[0].due_date, r.data[1].priority, r.data[1].due_date]).toEqual([1, '2026-10-01', 2, null])
  })

  it('the placeholder model splits lines', async () => {
    const r = await req('POST', '/capture', { text: '- one\n2. two\n\n* three', run_now: false })
    expect(r.data.map((t: any) => t.title)).toEqual(['one', 'two', 'three'])
  })
})

describe('follow-ups, defer and drop', () => {
  async function ready(act: unknown, title = 'Chase P60s') {
    const s = use(new Scripted({ worker: [{ summary: 'v', actions: [act] }], reviewer: [approve()] }))
    const t = await create({ title })
    await processQueue()
    const got = await get(t.id)
    expect(got.status).toBe('ready')
    return { got, s }
  }

  it('approved handover schedules a follow-up; delivered closes both', async () => {
    const { got } = await ready({ kind: 'delegate', title: 'Hand to Mandy', content: 'Mandy, please own this.', details: { owner: 'Mandy', due: '2026-10-02' } })
    expect((await req('POST', `/actions/${got.actions[0].id}/approve`, {})).data.follow_up_on).toBe('2026-10-02')
    const follow = (await req('GET', '/tasks')).data.find((t: any) => t.kind === 'follow_up')
    expect([follow.status, follow.follow_up_owner, follow.parent_id]).toEqual(['scheduled', 'Mandy', got.id])
    expect(await wakeScheduled('2026-10-01')).toBe(0)
    expect(await wakeScheduled('2026-10-02')).toBe(1)
    const brief = (await req('GET', '/briefing')).data
    expect(brief.follow_ups[0].id).toBe(follow.id)
    expect(brief.follow_ups[0].handover).toContain('Mandy, please own this.')
    await req('POST', `/tasks/${follow.id}/follow-up`, { outcome: 'delivered' })
    expect((await get(follow.id)).status).toBe('done')
    expect((await get(got.id)).status).toBe('done')
  })

  it('chase gives agents the handover; snooze defers', async () => {
    const { got, s } = await ready({ kind: 'delegate', title: 'Hand to Mandy', content: 'Original handover', details: { owner: 'Mandy', due: '2026-10-02' } })
    await req('POST', `/actions/${got.actions[0].id}/approve`, {})
    const follow = (await req('GET', '/tasks')).data.find((t: any) => t.kind === 'follow_up')
    await wakeScheduled('2026-10-02')
    expect((await req('POST', `/tasks/${follow.id}/follow-up`, { outcome: 'chase' })).data.status).toBe('queued')
    await processQueue()
    const ctx: any = s.calls.at(-2)!.payload
    expect(ctx.this_is_a_follow_up.owner).toBe('Mandy')
    expect(ctx.this_is_a_follow_up.handover_sent).toBe('Original handover')
    const r = (await req('POST', `/tasks/${follow.id}/follow-up`, { outcome: 'snooze', days: 3 })).data
    expect(r.status).toBe('scheduled')
    expect(r.scheduled_for).toBe(addDays(londonToday(), 3))
  })

  it('approving Defer parks the task; approving Drop closes it', async () => {
    const { got } = await ready({ kind: 'decision', title: 'Defer', content: 'Not now.', details: { verdict: 'defer', revisit: '2026-11-02' } }, 'Refresh website copy')
    const r = (await req('POST', `/actions/${got.actions[0].id}/approve`, {})).data
    expect([r.task_status, r.deferred_to]).toEqual(['scheduled', '2026-11-02'])
    await wakeScheduled('2026-11-02')
    expect((await get(got.id)).status).toBe('queued')
    const d = await ready({ kind: 'decision', title: 'Drop it', content: 'Not worth it.', details: { verdict: 'drop' } }, 'Rename the shared drive')
    expect((await req('POST', `/actions/${d.got.actions[0].id}/approve`, {})).data.task_status).toBe('done')
  })

  it('defers by hand', async () => {
    const t = await create()
    const r = (await req('POST', `/tasks/${t.id}/defer`, { until: '2026-12-01' })).data
    expect([r.status, r.scheduled_for]).toEqual(['scheduled', '2026-12-01'])
  })
})

describe('routines', () => {
  it('does the date maths', () => {
    expect(firstDue('weekly', 0, 1, '2026-09-26')).toBe('2026-09-28')
    expect(firstDue('weekly', 5, 1, '2026-09-26')).toBe('2026-09-26')
    expect(firstDue('monthly', 0, 10, '2026-09-26')).toBe('2026-10-10')
    expect(firstDue('monthly', 0, -1, '2026-02-03')).toBe('2026-02-28')
    expect(nextAfter('monthly', '2026-01-31', -1)).toBe('2026-02-28')
    expect(nextAfter('monthly', '2026-01-28', 28)).toBe('2026-02-28')
    expect(nextAfter('quarterly', '2026-11-15', 15)).toBe('2027-02-15')
    expect(nextAfter('fortnightly', '2026-09-28', 1)).toBe('2026-10-12')
  })

  it('creates a task within the lead time, once', async () => {
    const r = (await req('POST', '/routines', { title: 'Board pack', cadence: 'monthly', day_of_month: 10, lead_days: 5, next_due: '2026-10-10' })).data
    expect(await createDueRoutines('2026-10-04')).toEqual([])
    const made = await createDueRoutines('2026-10-05')
    expect(made.map((t) => [t.title, t.due_date, t.kind])).toEqual([['Board pack', '2026-10-10', 'routine']])
    expect(await createDueRoutines('2026-10-06')).toEqual([])
    const routines = (await req('GET', '/routines')).data.routines
    expect([routines[0].id, routines[0].next_due, routines[0].created_count]).toEqual([r.id, '2026-11-10', 1])
  })

  it('a lapsed routine creates one task, not a backlog', async () => {
    await req('POST', '/routines', { title: 'Weekly figures', cadence: 'weekly', weekday: 0, lead_days: 1, next_due: '2026-08-03' })
    expect(await createDueRoutines('2026-09-26')).toHaveLength(1)
    expect((await req('GET', '/routines')).data.routines[0].next_due).toBe('2026-09-28')
  })

  it('hides a suggestion once added', async () => {
    const sug = (await req('GET', '/routines')).data.suggested
    expect(sug.some((s: any) => s.title === 'Prepare the monthly board pack')).toBe(true)
    await req('POST', '/routines', sug[0])
    expect((await req('GET', '/routines')).data.suggested.map((s: any) => s.title)).not.toContain(sug[0].title)
  })
})

describe('learning and old tasks', () => {
  it('edits and send-backs become lessons the agents see', async () => {
    const s = use(new Scripted({ worker: [{ summary: 'v', actions: [action('Supplier email')] }], reviewer: [approve()] }))
    const t = await create()
    await processQueue()
    const aid = (await get(t.id)).actions[0].id
    await req('PATCH', `/actions/${aid}`, { content: 'Tighter body, signed Tom' })
    await req('POST', `/actions/${aid}/reject`, { reason: "Never open with 'I hope you are well'" })
    await processQueue()
    const seen: any[] = (s.calls.at(-1)!.payload as any).lessons_from_tom
    expect(seen[0].from).toBe('rejection')
    expect(seen[0].tom_said).toContain('hope you are well')
    expect([seen[1].from, seen[1].tom_changed_it_to, seen[1].agents_wrote]).toEqual(['edit', 'Tighter body, signed Tom', 'Body'])
    const d = (await req('GET', '/lessons')).data
    expect(d.lessons).toHaveLength(2)
    expect(d.stats.at(-1).sent_back).toBe(1)
    await req('PATCH', `/lessons/${d.lessons[0].id}`, { active: false })
    expect(await lessonsForContext(8)).toHaveLength(1)
    expect(await lessonsForContext(0)).toEqual([])
  })

  it('untouched tasks go back through Triage once per period', async () => {
    use(new Scripted({ worker: [{ summary: 'blocked', actions: null, questions: [{ question: 'Which supplier?' }] }], reviewer: [approve()] }))
    const t = await create()
    await processQueue()
    const now = Date.now()
    expect(await nudgeStale(14, new Date(now + 13 * 86400000))).toBe(0)
    expect(await nudgeStale(14, new Date(now + 15 * 86400000))).toBe(1)
    const got = await get(t.id)
    expect(got.status).toBe('queued')
    expect(got.questions[0].status).toBe('dismissed')
    expect(got.events.at(-1).content.text).toContain('DELEGATE or DROP')
    await q(`UPDATE tasks SET status = 'ready' WHERE id = $1`, [t.id])
    expect(await nudgeStale(14, new Date(now + 16 * 86400000))).toBe(0)
    expect(await nudgeStale(0, new Date(now + 100 * 86400000))).toBe(0)
  })
})

describe('morning push', () => {
  it('goes once, on weekdays, after the set time', () => {
    const p = { brief_enabled: true, brief_time: '07:30', brief_weekends: false, last_brief_date: null as string | null }
    const mon = new Date('2026-09-28T06:45:00Z') // 07:45 London (BST)
    expect(dueNow(p, mon)).toBe(true)
    expect(dueNow(p, new Date('2026-09-28T06:10:00Z'))).toBe(false)
    expect(dueNow(p, new Date('2026-09-27T08:00:00Z'))).toBe(false) // Sunday
    expect(dueNow({ ...p, last_brief_date: '2026-09-28' }, mon)).toBe(false)
    expect(dueNow({ ...p, brief_enabled: false }, mon)).toBe(false)
  })

  it('sends to Teams and phone', async () => {
    process.env.TEAMS_WEBHOOK_URL = 'https://teams.example/hook'
    process.env.NTFY_URL = 'https://ntfy.sh/tom-secret'
    const sent: [string, any][] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { sent.push([url, init]); return new Response('{}', { status: 200 }) }))
    use(new Scripted({ worker: [{ summary: 'v', actions: [action()] }], reviewer: [approve()] }))
    await create()
    await processQueue()
    const r = (await req('POST', '/notify/test')).data
    expect(r.results).toEqual({ teams: 'sent', phone: 'sent' })
    expect(r.brief.headline).toBe('1 ready to approve')
    const card = JSON.parse(sent[0][1].body).attachments[0].content
    expect(card.type).toBe('AdaptiveCard')
    expect(JSON.stringify(card)).toContain('Approve: Email to supplier')
    expect(sent[1][0]).toBe('https://ntfy.sh/tom-secret')
    expect(sent[1][1].headers.Click).toBe('https://aimelia.example/tasks')
    expect(sent[1][1].body).toContain('1 ready to approve')
  })

  it('says so when no channel is set up', async () => {
    const r = (await req('POST', '/notify/test')).data
    expect(r.results.none).toContain('No channel')
    expect(r.brief.empty).toBe(true)
  })
})

describe('focus time', () => {
  it('finds the first gap in working hours on a weekday', () => {
    expect(findSlot([], '2026-10-02T16:50', 60, '09:00', '17:30')![0]).toBe('2026-10-05T09:00') // Friday late -> Monday
    const busy: [string, string][] = [['2026-10-05T09:00', '2026-10-05T10:10'], ['2026-10-05T10:45', '2026-10-05T12:00']]
    expect(findSlot(busy, '2026-10-05T08:00', 30, '09:00', '17:30')).toEqual(['2026-10-05T10:15', '2026-10-05T10:45'])
    expect(findSlot(busy, '2026-10-05T08:00', 60, '09:00', '17:30')![0]).toBe('2026-10-05T12:00')
    expect(findSlot([['2026-10-05T00:00', '2026-10-20T00:00']], '2026-10-05T08:00', 60, '09:00', '17:30', 5)).toBeNull()
  })

  it('reports a clear error when Microsoft 365 is not connected', async () => {
    const t = await create()
    const r = await req('POST', `/tasks/${t.id}/book`, {})
    expect(r.status).toBe(401)
    expect(r.data.detail).toContain('not connected to Microsoft 365')
  })
})

describe('WSCIP and Payroll Command Center lookups', () => {
  it('refuses anything outside the catalogue', async () => {
    process.env.WSCIP_TOKEN = 't'
    await expect(lookup('wscip', 'delete_client')).rejects.toThrow(LLMError)
    await expect(lookup('other', 'compliance_position')).rejects.toThrow(LLMError)
  })

  it('signs in, filters params, and signs in again once on expiry', async () => {
    process.env.PCC_EMAIL = 'assistant@example.co'
    process.env.PCC_PASSWORD = 'pw'
    const logins: string[] = []
    const gets: [string, string][] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
      if (init.method === 'POST') { logins.push(url); return Response.json({ token: `tok${logins.length}` }) }
      gets.push([url, init.headers.Authorization])
      return gets.length === 1 ? new Response('', { status: 401 }) : Response.json({ runs: Array.from({ length: 40 }, (_, i) => i), note: 'x'.repeat(1000) })
    }))
    const out: any = await lookup('pcc', 'pay_runs', { client: 'Bentleys', evil: '1', from: '' })
    expect(logins).toHaveLength(2)
    expect(gets[0][0]).toBe('https://payrollcc.vercel.app/api/runs?client=Bentleys')
    expect(gets[1][1]).toBe('Bearer tok2')
    expect(out.runs).toHaveLength(26)
    expect(out.runs.at(-1)).toBe('... 15 more not shown')
    expect(out.note.endsWith(' ...')).toBe(true)
    expect(compact('y'.repeat(10))).toBe('yyyyyyyyyy')
  })

  it('gives the facts to the agents and logs the lookups', async () => {
    process.env.WSCIP_TOKEN = 'svc'
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ late: ['Bentleys MA Aug'] })))
    const s = new Scripted({ worker: [{ summary: 'v', actions: [action()] }], reviewer: [approve()],
      other: { lookup: [{ calls: [{ source: 'wscip', tool: 'compliance_position', params: {}, why: 'late MAs' }, { source: 'pcc', tool: 'todays_work' }] }] } })
    use(s)
    const t = await create({ title: 'Chase late Bentleys MA' })
    await processQueue()
    const lookupCall = s.calls.find((c) => c.role === 'lookup')!
    expect(Object.keys((lookupCall.payload as any).catalogue)).toEqual(['wscip'])
    const ctx: any = s.calls.find((c) => c.role === 'worker')!.payload
    expect(ctx.facts_from_ws_systems).toEqual({ 'wscip.compliance_position': { late: ['Bentleys MA Aug'] } })
    const events = (await get(t.id)).events
    expect(events.some((e: any) => e.kind === 'lookup' && e.content.calls[0].call === 'wscip.compliance_position')).toBe(true)
    await req('PATCH', '/pipeline', { use_ws_systems: false })
    await create({ title: 'Second' })
    const before = s.calls.length
    await processQueue()
    expect(s.calls.slice(before).some((c) => c.role === 'lookup')).toBe(false)
  })
})

describe('database guards', () => {
  it('claims each queued task once', async () => {
    await seedDefaults()
    const t = await create()
    const { claimNext } = await import('@/lib/agents/orchestrator')
    const [a, b] = await Promise.all([claimNext(), claimNext()])
    expect([a, b].filter(Boolean)).toEqual([t.id])
    expect((await one(`SELECT status FROM tasks WHERE id = $1`, [t.id]))!.status).toBe('processing')
  })
})
