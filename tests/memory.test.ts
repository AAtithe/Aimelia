import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { todoEndpoints } from '@/lib/agents/api'
import { chatEndpoints } from '@/lib/chat/api'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { processQueue } from '@/lib/agents/orchestrator'
import { learnFromNotes, nextWeeklyCheck, weekOf, weeklyCheck, weeklyCheckDue } from '@/lib/memory/learn'
import { one, q } from '@/lib/db'
import { call } from './helpers'

const todo = dispatcher('/api/todo', todoEndpoints)
const chat = dispatcher('/api/chat', chatEndpoints)
const req = (method: string, path: string, b?: unknown) => call(todo as any, { method, path: `/api/todo${path}`, body: b })
const talk = (b: unknown) => call(chat as any, { method: 'POST', path: '/api/chat/chats', body: b })

// Sunday 27 Sept 2026 at 19:00 London (18:00 UTC), and the Saturday before.
const SUNDAY_EVENING = new Date('2026-09-27T18:00:00Z')
const SATURDAY = new Date('2026-09-26T18:00:00Z')

/** Model replies by role; each role's list plays in order, the last one repeating. Every call is kept. */
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
    return typeof next === 'string' ? next : JSON.stringify(next ?? {})
  })
})
afterEach(() => { setModelTransport(null); setLaterHook(null) })

const memories = async () => (await req('GET', '/memory')).data
const shownTo = (role: string) => calls.filter((c) => c.role === role).map((c) => JSON.parse(c.messages[0].content))

async function askedTask() {
  replies.worker = [{ summary: 'need info', actions: null, questions: [{ question: 'Who signs off the Bentleys accounts?', why: 'to address it' }] }]
  const t = (await req('POST', '/tasks', { title: 'Send Bentleys the September accounts', run_now: false })).data
  await processQueue()
  const qn = (await req('GET', `/tasks/${t.id}`)).data.questions[0]
  return { t, qn }
}

describe('everything Tom writes is kept', () => {
  it('an answer to an agent question is kept word for word, and outlives the task', async () => {
    const { t, qn } = await askedTask()
    await req('POST', `/questions/${qn.id}/answer`, { answer: 'Sam Patel, the FD, signs them off. Copy in Priya.' })
    await req('DELETE', `/tasks/${t.id}`)
    const notes = (await req('GET', '/memory/notes')).data.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ source: 'answer', text: 'Sam Patel, the FD, signs them off. Copy in Priya.', learned: false })
    expect(notes[0].context).toMatchObject({ question: 'Who signs off the Bentleys accounts?', task: 'Send Bentleys the September accounts' })
  })

  it('feedback, send-back reasons, task briefs, brain dumps and Ask Aimelia messages are all kept', async () => {
    const t = (await req('POST', '/tasks', { title: 'Price the Soho group', notes: 'Six sites, they want a fixed monthly fee', run_now: false })).data
    await req('POST', `/tasks/${t.id}/feedback`, { text: 'We never quote below 1,500 a site' })
    await req('POST', '/capture', { text: 'chase corrigans tronc\nbook bentleys call', run_now: false })
    replies.chat = [{ reply: 'Noted.' }]
    await talk({ message: 'Corrigans have moved their year end to 30 June from next year' })
    await talk({ message: 'thanks' }) // too short to learn from
    const sources = (await req('GET', '/memory/notes')).data.notes.map((n: any) => n.source).sort()
    expect(sources).toEqual(['brain_dump', 'chat', 'feedback', 'task_brief'])
  })

  it('what Tom wrote before memory existed is brought in once, with its original date', async () => {
    const t = (await one(`INSERT INTO tasks (title, notes) VALUES ('Old Bentleys task', 'They want monthly packs by day 5') RETURNING id`))!
    await q(`INSERT INTO questions (task_id, question, answer, status, answered_at) VALUES ($1, 'Who signs off?', 'Sam Patel, the FD', 'answered', '2026-08-01T09:00:00Z'),
      ($1, 'Unanswered?', NULL, 'open', NULL)`, [t.id])
    await q(`INSERT INTO lessons (source, task_title, note) VALUES ('feedback', 'Old Bentleys task', 'Never copy the client on internal notes'), ('edit', 'x', '')`)
    await q(`INSERT INTO tasks (title, notes, source) VALUES ('Imported one', 'from a document', 'document')`)
    const { keepEarlierNotes } = await import('@/lib/memory/store')
    expect(await keepEarlierNotes()).toBe(3)
    expect(await keepEarlierNotes()).toBeNull() // once only
    const notes = (await req('GET', '/memory/notes')).data.notes
    expect(notes.map((n: any) => n.source).sort()).toEqual(['answer', 'feedback', 'task_brief'])
    expect(notes.find((n: any) => n.source === 'answer').created_at).toBe('2026-08-01T09:00:00.000Z')
  })

  it('Tom can delete a note', async () => {
    const { qn } = await askedTask()
    await req('POST', `/questions/${qn.id}/answer`, { answer: 'Sam Patel signs them off.' })
    const n = (await req('GET', '/memory/notes')).data.notes[0]
    expect((await req('DELETE', `/memory/notes/${n.id}`)).status).toBe(204)
    expect((await req('GET', '/memory/notes')).data.total).toBe(0)
  })
})

describe('learning from notes', () => {
  it('draws short memories from a note, each keeping where it came from', async () => {
    const { qn } = await askedTask()
    await req('POST', `/questions/${qn.id}/answer`, { answer: 'Sam Patel, the FD, signs them off.' })
    replies.memory = [{ ops: [{ op: 'add', kind: 'person', subject: 'Bentleys', content: 'Sam Patel is the FD at Bentleys and signs off the accounts.' }] }]
    expect(await learnFromNotes()).toBe(1)
    const d = await memories()
    expect(d.memories).toHaveLength(1)
    expect(d.memories[0]).toMatchObject({ kind: 'person', subject: 'Bentleys', pinned: false, created_by: 'aimelia' })
    expect(d.memories[0].sources[0]).toMatchObject({ source: 'answer', label: 'Your answer to an agent question', quote: 'Sam Patel, the FD, signs them off.' })
    expect((await req('GET', '/memory/notes')).data.notes[0].learned).toBe(true)
  })

  it('compares with what it already knows: updates, confirms, and asks when two disagree', async () => {
    const a = (await req('POST', '/memory', { kind: 'client', subject: 'Corrigans', content: 'Corrigans year end is 31 March.' })).data
    await q(`UPDATE memories SET pinned = false WHERE id = $1`, [a.id]) // as if Aimelia had drawn it
    const b = (await req('POST', '/memory', { kind: 'person', subject: 'Corrigans', content: 'Corrigans FD is Jo Hart.' })).data
    await talk({ message: 'Corrigans have moved their year end to 30 June, and Jo Hart has left' })
    replies.memory = [{ ops: [
      { op: 'update', id: a.id, content: 'Corrigans year end is 30 June.', why: 'Tom said it moved' },
      { op: 'conflict', ids: [b.id], question: 'Who is the FD at Corrigans now that Jo Hart has left?', why: 'Jo Hart is recorded as FD' },
      { op: 'update', id: 'not-shown', content: 'ignored' },
    ] }]
    await learnFromNotes()
    expect(shownTo('memory')[0].related_memories.map((m: any) => m.id).sort()).toEqual([a.id, b.id].sort())
    const d = await memories()
    expect(d.memories.find((m: any) => m.id === a.id).content).toBe('Corrigans year end is 30 June.')
    expect(d.questions.map((x: any) => x.question)).toEqual(['Who is the FD at Corrigans now that Jo Hart has left?'])
    expect(d.questions[0].memories[0].content).toBe('Corrigans FD is Jo Hart.')
  })

  it('never changes a memory Tom wrote or checked: it asks instead', async () => {
    const m = (await req('POST', '/memory', { kind: 'client', subject: 'Bentleys', content: 'Bentleys year end is 31 March.' })).data
    expect(m.pinned).toBe(true)
    replies.chat = [{ reply: 'ok' }]
    await talk({ message: 'Bentleys year end is actually 31 December now' })
    replies.memory = [{ ops: [{ op: 'update', id: m.id, content: 'Bentleys year end is 31 December.' }] }]
    await learnFromNotes()
    const d = await memories()
    expect(d.memories[0].content).toBe('Bentleys year end is 31 March.')
    expect(d.questions[0].question).toContain('Which is right now?')
  })

  it('answering a memory question is itself a note, and the memory is corrected from it', async () => {
    const m = (await req('POST', '/memory', { kind: 'client', subject: 'Bentleys', content: 'Bentleys year end is 31 March.' })).data
    await q(`INSERT INTO memory_questions (question, memory_ids) VALUES ('Is Bentleys year end still 31 March?', $1::jsonb)`, [JSON.stringify([m.id])])
    const x = (await memories()).questions[0]
    await req('POST', `/memory/questions/${x.id}/answer`, { answer: 'No, 31 December from 2027' })
    expect((await req('POST', `/memory/questions/${x.id}/answer`, { answer: 'again' })).status).toBe(404)
    const note = (await req('GET', '/memory/notes')).data.notes[0]
    expect(note).toMatchObject({ source: 'memory_answer', text: 'No, 31 December from 2027' })
    expect(note.context.about).toEqual(['Bentleys: Bentleys year end is 31 March.'])
    expect((await memories()).questions).toHaveLength(0)
  })

  it('a note that fails to be read is kept and tried again, three times at most', async () => {
    const { qn } = await askedTask()
    await req('POST', `/questions/${qn.id}/answer`, { answer: 'Sam Patel signs them off.' })
    replies.memory = [new Error('overloaded')]
    const tries = () => calls.filter((c) => c.role === 'memory').length
    await learnFromNotes()
    let n = (await req('GET', '/memory/notes')).data.notes[0]
    expect(n.learned).toBe(false)
    expect(n.error).toContain('overloaded')
    expect(tries()).toBe(1)
    await learnFromNotes()
    expect(tries()).toBe(1) // not again straight away: a later run tries it
    const later = () => q(`UPDATE memory_notes SET claimed_at = now() - interval '6 minutes'`)
    await later(); await learnFromNotes()
    await later(); await learnFromNotes()
    await later(); await learnFromNotes()
    expect(tries()).toBe(3)
    n = (await req('GET', '/memory/notes')).data.notes[0]
    expect([n.learned, n.text]).toEqual([false, 'Sam Patel signs them off.'])
  })
})

describe('what Aimelia knows is used', () => {
  it('the agent team is given the memories that bear on the task, and told to flag contradictions', async () => {
    await req('POST', '/memory', { kind: 'person', subject: 'Bentleys', content: 'Sam Patel is the FD at Bentleys and signs off the accounts.' })
    await req('POST', '/memory', { kind: 'preference', subject: 'Email', content: 'Tom signs off emails "Best, Tom", never "Kind regards".' })
    await req('POST', '/memory', { kind: 'client', subject: 'Corrigans', content: 'Corrigans year end is 30 June.' })
    const archived = (await req('POST', '/memory', { kind: 'person', subject: 'Bentleys', content: 'Jo is the Bentleys bookkeeper.' })).data
    await req('PATCH', `/memory/${archived.id}`, { status: 'archived' })
    replies.worker = [{ summary: 'done', actions: [{ kind: 'note', title: 'x', content: 'y', details: {} }] }]
    replies.reviewer = [{ verdict: 'approve', score: 9, feedback: '', action_feedback: [], questions: [] }]
    await req('POST', '/tasks', { title: 'Send Bentleys the September accounts', run_now: false })
    await processQueue()
    const payload = calls.find((c) => c.role === 'worker')!.payload as any
    const known = payload.what_aimelia_knows.map((m: any) => m.memory)
    expect(known).toContain('Sam Patel is the FD at Bentleys and signs off the accounts.')
    expect(known).toContain('Tom signs off emails "Best, Tom", never "Kind regards".') // standing preference, always given
    expect(known).not.toContain('Corrigans year end is 30 June.')
    expect(known).not.toContain('Jo is the Bentleys bookkeeper.')
    expect(payload.how_to_use_what_aimelia_knows).toContain('contradicts')
  })

  it('Ask Aimelia can search the memory, and remember what Tom tells it', async () => {
    await req('POST', '/memory', { kind: 'client', subject: 'Corrigans', content: 'Corrigans year end is 30 June.' })
    replies.chat = [
      { tool_calls: [{ tool: 'search_memory', args: { query: 'Corrigans year end' } }] },
      { tool_calls: [{ tool: 'remember', args: { subject: 'Corrigans', kind: 'person', fact: 'Priya Shah is the new FD at Corrigans.' } }] },
      { reply: 'Their year end is 30 June. I have noted Priya as FD.' },
    ]
    const r = await talk({ message: 'When is Corrigans year end? Also remember Priya Shah is their new FD' })
    expect(r.data.messages[1].content).toContain('30 June')
    const steps = (await one(`SELECT steps FROM chat_messages WHERE role = 'assistant'`))!.steps
    expect(steps.map((s: any) => s.tool)).toEqual(['search_memory', 'remember'])
    const d = await memories()
    expect(d.memories.find((m: any) => m.content.startsWith('Priya'))).toMatchObject({ pinned: true, created_by: 'tom' })
    expect(calls[0].system).toContain('search_memory')
  })
})

describe('Tom can see and change everything', () => {
  it('edits pin the memory and are logged with before and after; deletes are logged too', async () => {
    replies.memory = [{ ops: [{ op: 'add', kind: 'client', subject: 'Bentleys', content: 'Bentleys year end is 31 March.' }] }]
    await req('POST', '/tasks', { title: 'Bentleys year end', notes: 'Their year end is 31 March', run_now: false })
    await learnFromNotes()
    const m = (await memories()).memories[0]
    expect(m.pinned).toBe(false)
    const edited = (await req('PATCH', `/memory/${m.id}`, { content: 'Bentleys year end is 31 December.' })).data
    expect(edited.pinned).toBe(true)
    const h = (await req('GET', `/memory/${m.id}`)).data.history
    expect(h.map((x: any) => [x.action, x.actor])).toEqual([['added', 'capture'], ['edited', 'tom']])
    expect(h[1].before.content).toBe('Bentleys year end is 31 March.')
    await req('DELETE', `/memory/${m.id}`)
    const log = (await req('GET', '/memory/log')).data.log
    expect(log[0]).toMatchObject({ action: 'deleted', actor: 'tom', subject: 'Bentleys' })
    expect((await memories()).memories).toHaveLength(0)
  })

  it('search finds memories by any part of a word', async () => {
    await req('POST', '/memory', { kind: 'client', subject: 'Corrigans Mayfair', content: 'Tronc is run by the head chef.' })
    await req('POST', '/memory', { kind: 'client', subject: 'Bentleys', content: 'Year end 31 March.' })
    expect((await req('GET', '/memory?q=corrig')).data.memories.map((m: any) => m.subject)).toEqual(['Corrigans Mayfair'])
  })
})

describe('the weekly check', () => {
  async function seed() {
    const mk = async (subject: string, content: string, pinned = false) => {
      const m = (await req('POST', '/memory', { kind: 'client', subject, content })).data
      if (!pinned) await q(`UPDATE memories SET pinned = false WHERE id = $1`, [m.id])
      return m
    }
    return {
      a: await mk('Bentleys', 'Bentleys year end is 31 March.'),
      b: await mk('Bentleys', 'Bentleys have a March year end.'),
      c: await mk('Corrigans', 'Corrigans tronc review due September 2026.'),
      d: await mk('Soho group', 'Soho group pitch is on hold.'),
      p: await mk('Daffodil Mulligans', 'Daffodil Mulligans pay weekly.', true),
    }
  }

  it('is due from Sunday 18:00 London, once a week', async () => {
    expect(await weeklyCheckDue(SATURDAY)).toBe(false)
    expect(await weeklyCheckDue(new Date('2026-09-27T16:30:00Z'))).toBe(false) // 17:30 London
    expect(await weeklyCheckDue(SUNDAY_EVENING)).toBe(true)
    expect(weekOf(SUNDAY_EVENING)).toBe('2026-09-21')
    expect(nextWeeklyCheck(SATURDAY)).toBe('2026-09-27')
    expect(nextWeeklyCheck(SUNDAY_EVENING)).toBe('2026-10-04')
    replies.memory_review = [{ summary: 'Nothing to change.' }]
    await weeklyCheck('weekly', SUNDAY_EVENING)
    expect(await weeklyCheckDue(SUNDAY_EVENING)).toBe(false)
    expect(await weeklyCheck('weekly', SUNDAY_EVENING)).toBeNull() // a second tick the same week does nothing
  })

  it('cross-references everything, merges, updates, archives and asks; never touches what Tom checked', async () => {
    const s = await seed()
    await req('POST', '/tasks', { title: 'Corrigans tronc review', notes: 'Moved to November', run_now: false })
    replies.memory_review = [{
      summary: 'Merged two Bentleys memories, moved the Corrigans review date, archived the Soho pitch, and asked about Daffodil Mulligans.',
      merges: [{ ids: [s.a.id, s.b.id], subject: 'Bentleys', kind: 'client', content: 'Bentleys year end is 31 March.', why: 'same fact' }],
      updates: [{ id: s.c.id, content: 'Corrigans tronc review due November 2026.', why: 'the open task says November' }, { id: s.p.id, content: 'Daffodil Mulligans pay fortnightly.' }],
      archive: [{ id: s.d.id, why: 'pitch closed' }],
      questions: [{ question: 'Is the Soho group still a prospect?', why: 'no activity in a month', memory_ids: [s.d.id] }],
    }]
    const r = (await weeklyCheck('weekly', SUNDAY_EVENING))!
    expect(r.status).toBe('done')
    expect(r.counts).toMatchObject({ merged: 1, updated: 1, archived: 1, questions: 2, memories: 5 })
    const seen = shownTo('memory_review')[0]
    expect(seen.memories).toHaveLength(5)
    expect(seen.open_tasks.map((t: any) => t.title)).toContain('Corrigans tronc review')
    expect(seen.notes_this_week.map((n: any) => n.text)).toContain('Corrigans tronc review\n\nMoved to November')
    const d = await memories()
    const active = d.memories.map((m: any) => m.content).sort()
    expect(active).toEqual(['Bentleys year end is 31 March.', 'Corrigans tronc review due November 2026.', 'Daffodil Mulligans pay weekly.'])
    expect(d.memories.find((m: any) => m.subject === 'Bentleys').sources.length).toBeGreaterThanOrEqual(2)
    expect(d.questions.map((x: any) => x.question)).toEqual([expect.stringContaining('which you set yourself'), 'Is the Soho group still a prospect?'])
    expect(d.counts).toEqual({ active: 3, archived: 3 })
    expect(d.review).toMatchObject({ status: 'done', trigger: 'weekly' })
    const actors = (await req('GET', '/memory/log')).data.log.filter((l: any) => l.actor === 'weekly_check').map((l: any) => l.action)
    expect(actors.sort()).toEqual(['added', 'archived', 'archived', 'archived', 'edited'])
  })

  it('asks at most five questions a week and never repeats one already waiting', async () => {
    await seed()
    await q(`INSERT INTO memory_questions (question) VALUES ('Q1')`)
    replies.memory_review = [{ summary: 's', questions: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'].map((question) => ({ question, why: '' })) }]
    const r = (await weeklyCheck('manual'))!
    expect(r.counts.questions).toBe(5)
    expect((await memories()).questions.map((x: any) => x.question)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'])
  })

  it('a failed check says why, and Tom can run it again at once', async () => {
    await seed()
    replies.memory_review = [new Error('overloaded')]
    const r = (await weeklyCheck('weekly', SUNDAY_EVENING))!
    expect([r.status, r.error]).toEqual(['failed', expect.stringContaining('overloaded')])
    replies.memory_review = [{ summary: 'All fine.' }]
    expect((await req('POST', '/memory/check')).status).toBe(202)
  })

  it('refuses a second check while one is running', async () => {
    await q(`INSERT INTO memory_reviews (week, trigger, status) VALUES ('2026-09-21', 'manual', 'running')`)
    expect((await req('POST', '/memory/check')).status).toBe(409)
    expect((await memories()).review_running).toBe(true)
  })

  it('runs from the background timer on Sunday evening, and learns the week\'s notes first', async () => {
    const { qn } = await askedTask()
    await req('POST', `/questions/${qn.id}/answer`, { answer: 'Sam Patel signs them off.' })
    replies.memory = [{ ops: [{ op: 'add', kind: 'person', subject: 'Bentleys', content: 'Sam Patel signs off the Bentleys accounts.' }] }]
    replies.memory_review = [{ summary: 'One new memory this week; nothing to change.' }]
    const { tick } = await import('@/lib/tick')
    const report = await tick(SUNDAY_EVENING)
    expect(report.memory_notes).toBe(1)
    expect(report.memory_check).toBe('done')
    expect((await memories()).review.summary).toContain('One new memory')
  })

  it('shows in the briefing count when questions are waiting', async () => {
    await q(`INSERT INTO memory_questions (question) VALUES ('Is Bentleys year end still 31 March?')`)
    expect((await req('GET', '/briefing')).data.memory_questions).toBe(1)
  })
})
