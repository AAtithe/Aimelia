import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { processQueue } from '@/lib/agents/orchestrator'
import { cleanStages } from '@/lib/agents/stages'
import { buildBrief } from '@/lib/agents/notify'
import { TOOLS } from '@/lib/chat/agent'
import { q } from '@/lib/db'
import { call } from './helpers'

const api = dispatcher('/api/todo', todoEndpoints)
const req = (method: string, path: string, b?: unknown) => call(api as any, { method, path: `/api/todo${path}`, body: b })

/** Each worker reply is chosen from what the agent is shown, so a test can script a task stage by stage. */
function script(worker: (p: any) => unknown) {
  const calls: any[] = []
  setModelTransport(async (c: ModelCall) => {
    calls.push(c)
    if (c.role === 'reviewer') return JSON.stringify({ verdict: 'approve', score: 9, feedback: '', action_feedback: [], questions: [] })
    if (c.role === 'worker') return JSON.stringify(worker(c.payload) ?? { summary: 'kept', actions: null })
    return JSON.stringify({})
  })
  return calls
}

const ask = (to: string) => ({ kind: 'email_draft', title: `Ask ${to}`, content: `Please let me know.`, details: { to: `${to.toLowerCase()}@williamsstanley.co`, subject: 'Quick question' } })
const plan = [
  { kind: 'ask', who: 'Mandy', title: 'Has the June VAT return for Bentleys gone in?', details: 'The client wants the date' },
  { kind: 'ask', who: 'Ravi', title: 'What did HMRC say about the penalty?' },
  { kind: 'do', title: 'Reply to the client with the position' },
]

async function create(title = 'Confirm Bentleys VAT position') {
  const r = await req('POST', '/tasks', { title, notes: 'Client asked this morning', run_now: false })
  expect(r.status).toBe(201)
  return r.data
}
const get = async (id: string) => (await req('GET', `/tasks/${id}`)).data

beforeEach(() => { setLaterHook(() => {}) })
afterEach(() => { setModelTransport(null); setLaterHook(null) })

describe('tasks in stages', () => {
  it('cleans the stages a model gives', () => {
    const got = cleanStages([{ kind: 'ask', who: 'Mandy', title: 'When?' }, { kind: 'ask', title: 'no one named' }, { title: '' }, 'x', { kind: 'do', who: 'Z', title: 'Draft it' }])
    expect(got).toEqual([
      { kind: 'ask', who: 'Mandy', title: 'When?', details: '' },
      { kind: 'do', who: '', title: 'no one named', details: '' },
      { kind: 'do', who: '', title: 'Draft it', details: '' },
    ])
    expect(cleanStages(null)).toEqual([])
  })

  it('goes and asks, takes the answer into the next stage, and finishes with the answers', async () => {
    const calls = script((p) => {
      if (p.you_are !== 'Planner') return null
      if (!p.task_stages) return { summary: 'Needs Mandy then Ravi', stages: plan, actions: [ask('Mandy')] }
      const cur = p.current_stage
      if (typeof cur === 'string') return { summary: 'finished', actions: [{ kind: 'email_draft', title: 'Reply to client', content: 'Filed on 7 July; no penalty.', details: { to: 'client@bentleys.co', subject: 'VAT' } }] }
      if (cur.kind === 'ask') return { summary: `ask ${cur.ask}`, actions: [ask(cur.ask)] }
      return { summary: 'reply', actions: [{ kind: 'document', title: 'Client reply', content: 'Position', details: {} }] }
    })
    const t = await create()
    await processQueue()

    // Laid out by the Planner, and the draft is for the first stage only.
    let got = await get(t.id)
    expect(got.stages.map((s: any) => [s.kind, s.who, s.status])).toEqual([['ask', 'Mandy', 'open'], ['ask', 'Ravi', 'open'], ['do', '', 'open']])
    expect(got.stages[0].added_by).toBe('Planner')
    expect(got.status).toBe('ready')
    expect(got.actions[0].details.stage_id).toBe(got.stages[0].id)
    // The Chief of Staff, after the Planner, already sees the stages.
    const cos = calls.find((c) => c.payload?.you_are === 'Chief of Staff')
    expect(cos.payload.current_stage.ask).toBe('Mandy')
    expect(cos.payload.how_to_work_in_stages).toMatch(/current stage only/)
    expect(calls[0].system).toContain('"stages"')

    // Approve the ask and send it: the task waits on Mandy, not closed.
    await req('POST', `/actions/${got.actions[0].id}/approve`, {})
    const done = await req('POST', `/actions/${got.actions[0].id}/done`, { follow_up: true })
    expect(done.data.task_status).toBe('waiting')
    expect(done.data.follow_up_on).toBeTruthy()

    // Today shows the stage to ask, with where it sits.
    let brief = (await req('GET', '/briefing')).data
    expect(brief.stages).toHaveLength(1)
    expect(brief.stages[0]).toMatchObject({ who: 'Mandy', stage_number: 1, stage_count: 3, task_title: 'Confirm Bentleys VAT position' })
    expect(brief.counts.waiting).toBe(1)
    expect((await buildBrief()).lines).toContain('Ask Mandy: Has the June VAT return for Bentleys gone in? (Confirm Bentleys VAT position)')

    // Mandy's answer: recorded, kept, the check on her email closed, and the task back with the team for Ravi.
    const r = await req('POST', `/stages/${brief.stages[0].id}/answer`, { answer: 'Filed on 7 July' })
    expect(r.status).toBe(200)
    expect(r.data.next_stage.who).toBe('Ravi')
    expect(r.data.task_resumed).toBe(true)
    expect(r.data.task.status).toBe('queued')
    const checks = await q(`SELECT status FROM tasks WHERE kind = 'follow_up' AND parent_id = $1`, [t.id])
    expect(checks.map((c) => c.status)).toEqual(['done'])
    const notes = await q(`SELECT text FROM memory_notes WHERE ref = $1`, [`stage:${brief.stages[0].id}`])
    expect(notes[0].text).toContain('Mandy on "Has the June VAT return for Bentleys gone in?": Filed on 7 July')
    expect((await req('POST', `/stages/${brief.stages[0].id}/answer`, { answer: 'again' })).status).toBe(409)

    calls.length = 0
    await processQueue()
    got = await get(t.id)
    const planner = calls.find((c) => c.payload?.you_are === 'Planner')
    expect(planner.payload.task_stages[0]).toMatchObject({ ask: 'Mandy', answer: 'Filed on 7 July', status: 'done' })
    expect(planner.payload.current_stage.ask).toBe('Ravi')
    expect(got.actions.filter((a: any) => a.status === 'proposed').map((a: any) => a.title)).toEqual(['Ask Ravi'])

    // Tom asked Ravi in person: the drafted email goes, and the do stage comes next.
    brief = (await req('GET', '/briefing')).data
    await req('POST', `/stages/${brief.stages[0].id}/answer`, { answer: 'No penalty' })
    expect((await q(`SELECT status FROM actions WHERE task_id = $1 AND title = 'Ask Ravi'`, [t.id])).map((a) => a.status)).toEqual(['superseded'])
    await processQueue()
    brief = (await req('GET', '/briefing')).data
    expect(brief.stages[0]).toMatchObject({ kind: 'do', stage_number: 3 })
    expect(brief.stages[0].earlier.map((e: any) => e.answer)).toEqual(['Filed on 7 July', 'No penalty'])

    // The last stage done: the team finishes the task, and it closes once the work is done.
    await req('POST', `/stages/${brief.stages[0].id}/done`, { outcome: '' })
    await processQueue()
    got = await get(t.id)
    expect(got.stages.every((s: any) => s.status === 'done')).toBe(true)
    const last = got.actions.find((a: any) => a.status === 'proposed')
    expect(last.title).toBe('Reply to client')
    expect(last.details.stage_id).toBeUndefined()
    await req('POST', `/actions/${last.id}/approve`, {})
    const closed = await req('POST', `/actions/${last.id}/done`, { follow_up: false })
    expect(closed.data.task_status).toBe('done')
    expect((await req('GET', '/briefing')).data.stages).toEqual([])
  })

  it('lets Tom lay out, edit, skip and remove stages himself', async () => {
    script(() => ({ summary: 'nothing to draft', actions: [] }))
    const t = await create('Agree the Q3 bonus pool')
    expect((await req('POST', `/tasks/${t.id}/stages`, { stages: [{ kind: 'ask', title: 'no one' }] })).status).toBe(422)
    let r = await req('POST', `/tasks/${t.id}/stages`, { stages: [
      { kind: 'ask', who: 'Sam', title: 'What is the forecast profit?' },
      { kind: 'ask', who: 'Jo', title: 'Which of the team hit target?' },
      { kind: 'do', title: 'Propose the pool' },
    ] })
    expect(r.status).toBe(201)
    const [sam, jo, propose] = r.data.stages
    r = await req('PATCH', `/stages/${jo.id}`, { who: 'Joanne' })
    expect(r.data.stages[1].who).toBe('Joanne')

    // A run with nothing to draft leaves the task waiting on Sam, not failed.
    await processQueue()
    expect((await get(t.id)).status).toBe('waiting')

    r = await req('POST', `/stages/${sam.id}/skip`)
    expect(r.data.stage.status).toBe('skipped')
    await processQueue()
    expect((await req('DELETE', `/stages/${sam.id}`)).status).toBe(409)
    // Removing the stage it waits on, with none left after, sends it to the team to finish.
    await req('DELETE', `/stages/${propose.id}`)
    await req('POST', `/stages/${jo.id}/answer`, { answer: 'Four of six' })
    await processQueue()
    const got = await get(t.id)
    expect(got.stages.map((s: any) => s.status)).toEqual(['skipped', 'done'])
    expect(got.status).toBe('failed') // the scripted team drafted nothing at the end
    expect(got.events.some((e: any) => e.kind === 'stage' && e.content.answer === 'Four of six')).toBe(true)
  })

  it('waits for a question to Tom before moving on, and refuses while the agents work', async () => {
    script(() => null)
    const t = await create()
    const s = (await req('POST', `/tasks/${t.id}/stages`, { stages: [{ kind: 'ask', who: 'Mandy', title: 'When?' }, { kind: 'do', title: 'Reply' }] })).data.stages
    await q(`UPDATE tasks SET status = 'processing' WHERE id = $1`, [t.id])
    expect((await req('POST', `/stages/${s[0].id}/answer`, { answer: 'Friday' })).status).toBe(409)
    await q(`UPDATE tasks SET status = 'needs_input' WHERE id = $1`, [t.id])
    await q(`INSERT INTO questions (task_id, asked_by, question) VALUES ($1, 'Planner', 'Which client?')`, [t.id])
    const r = await req('POST', `/stages/${s[0].id}/answer`, { answer: 'Friday' })
    expect(r.data.task_resumed).toBe(false)
    expect(r.data.task.status).toBe('needs_input')
  })

  it('takes the answer from Ask Aimelia', async () => {
    script(() => null)
    const t = await create()
    await req('POST', `/tasks/${t.id}/stages`, { stages: [{ kind: 'ask', who: 'Mandy', title: 'When?' }] })
    const b = await TOOLS.briefing.run({}) as any
    expect(b.stages_waiting_on_tom[0]).toMatchObject({ ask: 'Mandy', what: 'When?', stage: '1 of 1' })
    const r = await TOOLS.record_stage_answer.run({ stage_id: b.stages_waiting_on_tom[0].stage_id, answer: 'Friday' }) as any
    expect(r).toMatchObject({ recorded: true, next_stage: 'none: the team finishes the task', task_back_with_agents: true })
    expect(await TOOLS.record_stage_answer.run({ stage_id: b.stages_waiting_on_tom[0].stage_id, answer: 'again' })).toMatch(/^Not recorded/)
    const task = await TOOLS.get_task.run({ id: t.id }) as any
    expect(task.stages[0]).toMatchObject({ status: 'done', answer: 'Friday' })
  })
})
