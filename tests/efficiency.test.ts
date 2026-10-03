import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { getPipeline, processQueue } from '@/lib/agents/orchestrator'
import { efficiencyDue, runEfficiency } from '@/lib/agents/efficiency'
import { one, q } from '@/lib/db'
import { call } from './helpers'

const api = dispatcher('/api/todo', todoEndpoints)
const req = (method: string, path: string, b?: unknown) => call(api as any, { method, path: `/api/todo${path}`, body: b })

let replies: Record<string, unknown[]> = {}
let calls: ModelCall[] = []
const next = (role: string) => { const r = replies[role] || []; return r.length > 1 ? r.shift() : r[0] }
beforeEach(() => {
  replies = { reviewer: [{ verdict: 'approve', score: 9, feedback: '', action_feedback: [], questions: [] }] }
  calls = []
  setLaterHook(() => {})
  setModelTransport(async (c) => { calls.push(c); return JSON.stringify(next(c.role) ?? {}) })
})
afterEach(() => { setModelTransport(null); setLaterHook(null) })

const blocked = (...questions: string[]) => ({ summary: 'blocked', actions: null, questions: questions.map((question) => ({ question, why: '' })) })
const done = { summary: 'done', actions: [{ kind: 'note', title: 'Noted', content: 'x', details: {} }] }
async function task(title: string) { return (await req('POST', '/tasks', { title, run_now: false })).data }
const get = async (id: string) => (await req('GET', `/tasks/${id}`)).data

/** Task A asked who the FD is, and Tom answered. */
async function answeredOnA() {
  replies.worker = [blocked('Who is the FD at Corrigans?')]
  const a = await task('Corrigans year-end pack')
  await processQueue()
  const qa = (await get(a.id)).questions[0]
  await req('POST', `/questions/${qa.id}/answer`, { answer: 'Jo Hart, the FD, since March' })
  await q(`UPDATE tasks SET status = 'done' WHERE id = $1`, [a.id])
  return { a, qa }
}

describe('the efficiency agent at the door', () => {
  it('answers a question Tom already answered on another task, so he is not asked and the task carries on', async () => {
    await answeredOnA()
    replies.worker = [blocked('Who is the Corrigans FD?'), blocked('Who is the Corrigans FD?'), done] // Triage cannot ask; the Planner asks
    replies.screen = [{ questions: [{ index: 0, verdict: 'answered', answer: 'Jo Hart', from: 'your answer on Corrigans year-end pack' }] }]
    const b = await task('Corrigans tronc sign-off')
    await processQueue()

    const screen = calls.find((c) => c.role === 'screen')!
    expect((screen.payload as any).tom_already_answered.map((x: any) => x.answer)).toEqual(['Jo Hart, the FD, since March'])
    const got = await get(b.id)
    expect(got.questions.map((x: any) => [x.status, x.answer, x.answered_by])).toEqual([['answered', 'Jo Hart', 'aimelia']])
    expect(got.status).toBe('ready') // went back to the team and finished without Tom
    expect((await req('GET', '/briefing')).data.questions).toEqual([])

    // The next run had the answer, and earlier answers from other tasks.
    const ctx: any = calls.filter((c) => c.role === 'worker').at(-1)!.payload
    expect(ctx.answered_questions).toEqual([{ question: 'Who is the Corrigans FD?', answer: 'Jo Hart' }])
    expect(ctx.tom_answered_on_other_tasks[0].answer).toBe('Jo Hart, the FD, since March')

    // It is shown to Tom to check; Not right asks him again and holds the task.
    const eff = (await req('GET', '/efficiency')).data
    expect(eff.answered_for_you.map((x: any) => [x.question, x.answer, x.source])).toEqual([['Who is the Corrigans FD?', 'Jo Hart', 'your answer on Corrigans year-end pack']])
    const qid = eff.answered_for_you[0].id
    const r = (await req('POST', `/questions/${qid}/reopen`)).data
    expect([r.question.status, r.task.status]).toEqual(['open', 'needs_input'])
    expect((await get(b.id)).actions.filter((a: any) => a.status === 'proposed')).toEqual([])
    expect((await req('GET', '/briefing')).data.questions.map((x: any) => x.id)).toEqual([qid])
    expect((await req('POST', `/questions/${qid}/reopen`)).status).toBe(404)
  })

  it('joins a question already waiting on another task, so one answer settles both', async () => {
    replies.worker = [blocked('How many sites does the Soho group have?')]
    const a = await task('Soho group pricing')
    await processQueue()
    const qa = (await get(a.id)).questions[0]

    replies.worker = [blocked('Number of Soho sites?')]
    replies.screen = [{ questions: [{ index: 0, verdict: 'same_as_open', open_id: qa.id }] }]
    const b = await task('Soho group proposal')
    await processQueue()
    const qb = (await get(b.id)).questions[0]
    expect([qb.status, (await get(b.id)).status]).toEqual(['merged', 'needs_input'])
    const brief = (await req('GET', '/briefing')).data
    expect(brief.questions.map((x: any) => [x.id, x.also_for.map((t: any) => t.title)])).toEqual([[qa.id, ['Soho group proposal']]])

    await req('POST', `/questions/${qa.id}/answer`, { answer: 'Six' })
    expect([(await get(a.id)).status, (await get(b.id)).status]).toEqual(['queued', 'queued'])
  })

  it('asks Tom as usual when unsure, when the reply is malformed, or with no AI', async () => {
    await answeredOnA()
    replies.worker = [blocked('What fee did we quote?', 'Who is the FD at Corrigans now?')]
    replies.screen = [{ questions: [{ index: 0, verdict: 'answered', answer: '' }, { index: 1, verdict: 'same_as_open', open_id: 'nope' }, { index: 7, verdict: 'answered', answer: 'x' }] }]
    const b = await task('Corrigans fee review')
    await processQueue()
    expect((await get(b.id)).questions.map((x: any) => x.status)).toEqual(['open', 'open'])
  })
})

describe('the daily sweep', () => {
  it('runs once a day after its time, finds questions that keep coming back, and a kept standing answer stops them', async () => {
    const p = await getPipeline()
    const morning = new Date('2026-10-05T05:00:00Z') // 06:00 London
    const later = new Date('2026-10-05T06:00:00Z') // 07:00 London
    expect(await efficiencyDue(p, morning)).toBe(false)
    expect(await efficiencyDue(p, later)).toBe(true)

    const { qa } = await answeredOnA()
    replies.worker = [blocked('Who signs off for Corrigans?', 'Which VAT quarter?')]
    const b = await task('Corrigans VAT')
    replies.screen = [{ questions: [{ index: 0, verdict: 'ask' }, { index: 1, verdict: 'ask' }] }]
    await processQueue()
    const qb = (await get(b.id)).questions[0]
    replies.recurring = [{ recurring: [
      { topic: 'Corrigans FD', standing_answer: 'Jo Hart is the FD at Corrigans and signs off for them.', question_ids: [qa.id, qb.id], times: 2 },
      { topic: 'Made up', standing_answer: 'x', question_ids: ['nope', 'nope2'] },
    ] }]
    const run = (await runEfficiency('daily', later))!
    expect(run.report.recurring).toHaveLength(1)
    expect(await runEfficiency('daily', later)).toBeNull()
    expect(await efficiencyDue(p, later)).toBe(false)

    const eff = (await req('GET', '/efficiency')).data
    expect(eff.recurring.map((r: any) => r.topic)).toEqual(['Corrigans FD'])
    expect((await req('POST', '/efficiency/standing', { topic: 'Corrigans FD', answer: 'Jo Hart is the FD at Corrigans and signs off for them.' })).status).toBe(201)
    expect(await one(`SELECT pinned, content FROM memories WHERE subject = 'Corrigans FD'`)).toEqual({ pinned: true, content: 'Jo Hart is the FD at Corrigans and signs off for them.' })
    expect((await req('GET', '/efficiency')).data.recurring).toEqual([])

    await req('PATCH', '/pipeline', { efficiency_enabled: false })
    expect(await efficiencyDue(await getPipeline(), new Date('2026-10-06T06:00:00Z'))).toBe(false)
  })
})
