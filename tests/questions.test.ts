import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { processQueue } from '@/lib/agents/orchestrator'
import { nudgeStale } from '@/lib/agents/schedule'
import { similarity, tidyQuestions } from '@/lib/agents/questions'
import { one, q } from '@/lib/db'
import { cleanOptions, fillMissingOptions } from '@/lib/agents/options'
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

/** A task the Planner has paused on with these questions. */
async function asked(title: string, ...questions: string[]) {
  replies.worker = [{ summary: 'blocked', actions: null, questions: questions.map((question) => ({ question, why: '' })) }]
  const t = (await req('POST', '/tasks', { title, run_now: false })).data
  await processQueue()
  const d = (await req('GET', `/tasks/${t.id}`)).data
  expect(d.status).toBe('needs_input')
  return d
}
const brief = async () => (await req('GET', '/briefing')).data
const status = async (id: string) => (await one(`SELECT status FROM tasks WHERE id = $1`, [id]))!.status

describe('questions', () => {
  it('judges near-identical wording as the same question', () => {
    expect(similarity('Who is the supplier?', "Who's the supplier?")).toBe(1)
    expect(similarity('Who is the FD at Corrigans?', 'Who is the FD at Corrigans now?')).toBeGreaterThanOrEqual(0.75)
    expect(similarity('Which site?', 'Which supplier?')).toBe(0)
  })

  it('does not ask a task the same question twice in other words', async () => {
    const t = await asked('Linen contract', 'Who is the supplier?', "Who's the supplier?", 'What is the budget?')
    expect(t.questions.map((x: any) => x.question)).toEqual(['Who is the supplier?', 'What is the budget?'])
  })

  it('merges one question asked on two tasks, and one answer frees both', async () => {
    const a = await asked('Corrigans Q3 tronc sign-off', 'Who is the FD at Corrigans?')
    const b = await asked('Corrigans year-end pack', 'Who should the Corrigans pack go to?', 'What date is the year end?')
    const [qa] = a.questions, [qb, qc] = b.questions
    replies.questions = [{ merge: [{ keep: qa.id, merge: [qb.id], question: 'Who is the FD at Corrigans, for the tronc sign-off and the year-end pack?', why: 'Both go to them' }], answered: [], reword: [] }]
    const r = await tidyQuestions()
    expect(r).toMatchObject({ merged: 1 })
    expect(calls.find((c) => c.role === 'questions')!.payload).toMatchObject({ open_questions: expect.arrayContaining([expect.objectContaining({ id: qb.id })]) })

    const br = await brief()
    expect(br.questions.map((x: any) => x.id).sort()).toEqual([qa.id, qc.id].sort())
    const lead = br.questions.find((x: any) => x.id === qa.id)
    expect(lead.question).toContain('year-end pack')
    expect(lead.also_for).toEqual([{ task_id: b.id, title: 'Corrigans year-end pack' }])
    const onB = (await req('GET', `/tasks/${b.id}`)).data.questions.find((x: any) => x.id === qb.id)
    expect(onB).toMatchObject({ status: 'merged', question: lead.question, shared_with: { task_id: a.id } })
    expect((await req('GET', `/tasks/${b.id}`)).data.open_questions).toBe(2)

    // Answering on either task answers both; b still waits on its other question.
    const res = (await req('POST', `/questions/${qb.id}/answer`, { answer: 'Jo Hart' })).data
    expect(res).toMatchObject({ task_resumed: false, tasks_resumed: 1 })
    expect(await status(a.id)).toBe('queued')
    expect(await status(b.id)).toBe('needs_input')
    expect(await one(`SELECT status, answer FROM questions WHERE id = $1`, [qa.id])).toEqual({ status: 'answered', answer: 'Jo Hart' })
    await req('POST', `/questions/${qc.id}/answer`, { answer: '31 March' })
    expect(await status(b.id)).toBe('queued')
  })

  it('answers what Tom has already answered, suggests when unsure, rewords what is out of date, and skips when nothing changed', async () => {
    const a = await asked('Bentleys labour call', 'Who signs off Bentleys?')
    await req('POST', `/questions/${a.questions[0].id}/answer`, { answer: 'Sam Patel, the FD' })
    const b = await asked('Bentleys accounts', 'Who is the Bentleys FD?', 'Which bank do they use?', 'What year end and which auditor?')
    const [q1, q2, q3] = b.questions
    replies.questions = [{
      merge: [],
      answered: [{ id: q1.id, answer: 'Sam Patel', from: 'Who signs off Bentleys?', confidence: 'high' }, { id: q2.id, answer: 'Barclays', from: 'an old note', confidence: 'medium' }],
      reword: [{ id: q3.id, question: 'Which auditor? You said the year end is 31 March.', why: '' }, { id: 'not-an-id', question: 'x' }],
    }]
    expect(await tidyQuestions()).toMatchObject({ answered: 1, suggested: 1, reworded: 1 })
    const d = (await req('GET', `/tasks/${b.id}`)).data
    const by = Object.fromEntries(d.questions.map((x: any) => [x.id, x]))
    expect(by[q1.id]).toMatchObject({ status: 'answered', answer: 'Sam Patel', answered_by: 'aimelia' })
    expect(by[q2.id]).toMatchObject({ status: 'open', suggested_answer: 'Barclays', suggested_from: 'an old note' })
    expect(by[q3.id]).toMatchObject({ question: 'Which auditor? You said the year end is 31 March.' })
    expect(by[q3.id].updated_at).toBeTruthy()
    expect(d.events.some((e: any) => e.kind === 'question_update')).toBe(true)
    expect(d.status).toBe('needs_input')

    const before = calls.length
    expect(await tidyQuestions()).toMatchObject({ skipped: 'unchanged' })
    expect(calls.length).toBe(before)
  })

  it('ignores a reply that names a question twice or one that is not open', async () => {
    const a = await asked('Task A', 'First thing?')
    const b = await asked('Task B', 'Second thing?')
    replies.questions = [{ merge: [{ keep: a.questions[0].id, merge: [a.questions[0].id] }, { keep: b.questions[0].id, merge: ['nope'] }], answered: [], reword: [] }]
    expect(await tidyQuestions()).toMatchObject({ merged: 0 })
    expect((await brief()).questions).toHaveLength(2)
  })

  it('hands a group to the next task when the lead task goes', async () => {
    const a = await asked('Soho group pricing', 'How many sites does the Soho group have?')
    const b = await asked('Soho group proposal', 'How many Soho sites?')
    replies.questions = [{ merge: [{ keep: a.questions[0].id, merge: [b.questions[0].id], question: 'How many sites does the Soho group have?' }] }]
    await tidyQuestions()

    // The lead task goes stale and back through Triage: b's copy takes over.
    await q(`UPDATE tasks SET last_touched_at = now() + interval '5 days' WHERE id = $1`, [b.id])
    await nudgeStale(1, new Date(Date.now() + 2 * 86400000))
    const onB = await one(`SELECT status, merged_into, question FROM questions WHERE id = $1`, [b.questions[0].id])
    expect(onB).toEqual({ status: 'open', merged_into: null, question: 'How many sites does the Soho group have?' })
  })

  it('repairs a group whose lead task was deleted', async () => {
    const a = await asked('Lead task', 'Which Mayfair site?')
    const b = await asked('Other task', 'Which site in Mayfair?')
    replies.questions = [{ merge: [{ keep: a.questions[0].id, merge: [b.questions[0].id] }] }]
    await tidyQuestions()
    await q(`DELETE FROM tasks WHERE id = $1`, [a.id])
    expect((await tidyQuestions()).repaired).toBe(1)
    expect((await brief()).questions.map((x: any) => x.id)).toEqual([b.questions[0].id])
  })

  it('skipping a shared question lets every task it held go on', async () => {
    const a = await asked('Task one', 'Is the new menu live?')
    const b = await asked('Task two', 'Has the new menu launched?')
    replies.questions = [{ merge: [{ keep: a.questions[0].id, merge: [b.questions[0].id] }] }]
    await tidyQuestions()
    const res = (await req('POST', `/questions/${a.questions[0].id}/dismiss`)).data
    expect(res.tasks_resumed).toBe(2)
    expect([await status(a.id), await status(b.id)]).toEqual(['queued', 'queued'])
  })

  it('needs a model that can judge meaning', async () => {
    setModelTransport(null)
    await q(`INSERT INTO tasks (title, status) VALUES ('x', 'needs_input')`)
    const [t] = await q(`SELECT id FROM tasks`)
    await q(`INSERT INTO questions (task_id, question) VALUES ($1, 'One?'), ($1, 'Two?')`, [t.id])
    expect(await tidyQuestions()).toMatchObject({ skipped: 'no AI key' })
  })
})

describe('every question comes with answers to pick', () => {
  it('keeps the options an agent gives, tidied', () => {
    expect(cleanOptions(['Sam Patel', ' sam patel ', 'Other', '', 'Jo Hart', 'Not sure', 'A', 'B', 'C'])).toEqual(['Sam Patel', 'Jo Hart', 'A', 'B'])
    expect(cleanOptions(['Only one'])).toEqual([])
    expect(cleanOptions('nope')).toEqual([])
  })

  it('saves the options the agent gave and shows them to Tom', async () => {
    replies.worker = [{ summary: 'blocked', actions: null, questions: [{ question: 'Who signs off Bentleys?', why: 'to address it', options: ['Sam Patel, the FD', 'Jo Hart'] }] }]
    const t = (await req('POST', '/tasks', { title: 'Bentleys accounts', run_now: false })).data
    await processQueue()
    expect((await brief()).questions[0].options).toEqual(['Sam Patel, the FD', 'Jo Hart'])
    expect(calls.some((c) => c.role === 'question_options')).toBe(false)
    const res = (await req('POST', `/questions/${(await brief()).questions[0].id}/answer`, { answer: 'Sam Patel, the FD' })).data
    expect(res.task_resumed).toBe(true)
    expect(await status(t.id)).toBe('queued')
  })

  it('suggests options when the agent left them out', async () => {
    replies.question_options = [{ questions: [{ index: 0, options: ['31 March', '31 December'] }] }]
    const t = await asked('Corrigans year end', 'What is the year end?')
    expect(t.questions[0].options).toEqual(['31 March', '31 December'])
    expect(calls.find((c) => c.role === 'question_options')!.payload).toMatchObject({ questions: [{ index: 0, question: 'What is the year end?', about: 'Task: Corrigans year end' }] })
  })

  it('gives options to questions asked before they existed, once', async () => {
    const t = await asked('Linen contract', 'Who is the supplier?')
    await q(`UPDATE questions SET options = NULL`)
    replies.question_options = [{ questions: [{ index: 0, options: ['Johnsons', 'Elis'] }] }]
    expect(await fillMissingOptions()).toBe(1)
    expect((await req('GET', `/tasks/${t.id}`)).data.questions[0].options).toEqual(['Johnsons', 'Elis'])
    const before = calls.length
    expect(await fillMissingOptions()).toBe(0)
    expect(calls.length).toBe(before)
  })

  it('a reworded question gets new options, or has them suggested again', async () => {
    const t = await asked('Bentleys audit', 'What year end and which auditor?', 'Which bank?')
    const [a, b] = t.questions
    replies.questions = [{ reword: [{ id: a.id, question: 'Which auditor?', options: ['Haysmacintyre', 'Moore Kingston Smith'] }, { id: b.id, question: 'Which bank now?' }] }]
    await tidyQuestions()
    const by = Object.fromEntries((await req('GET', `/tasks/${t.id}`)).data.questions.map((x: any) => [x.id, x]))
    expect(by[a.id].options).toEqual(['Haysmacintyre', 'Moore Kingston Smith'])
    expect((await one(`SELECT options FROM questions WHERE id = $1`, [b.id]))!.options).toBeNull()
  })
})
