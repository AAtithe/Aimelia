import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatcher, setLaterHook } from '@/lib/router'
import { chatEndpoints } from '@/lib/chat/api'
import { resetChatModel } from '@/lib/chat/agent'
import { reviewEvents } from '@/lib/chat/calendar'
import { setModelTransport, type ModelCall } from '@/lib/llm'
import { encrypt } from '@/lib/crypto'
import { one, q } from '@/lib/db'
import { call } from './helpers'

const api = dispatcher('/api/chat', chatEndpoints)
const req = (method: string, path: string, b?: unknown) => call(api as any, { method, path: `/api/chat${path}`, body: b })

function script(...replies: unknown[]) {
  const calls: ModelCall[] = []
  setModelTransport(async (c) => {
    calls.push({ ...c, messages: c.messages.map((m) => ({ ...m })) }) // a copy: later steps add to the same list
    const next = replies.length > 1 ? replies.shift() : replies[0]
    return typeof next === 'string' ? next : JSON.stringify(next)
  })
  return calls
}

// A fake Microsoft Graph: Tom's calendar and what was asked of it.
type Hit = { method: string; path: string; query: URLSearchParams; body: any }
let hits: Hit[] = []
let calendar: any[] = []
const ME = 'owner@example.co'
const ev = (id: string, subject: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id, subject, start: { dateTime: `${start}:00.0000000` }, end: { dateTime: `${end}:00.0000000` }, showAs: 'busy', isOrganizer: true,
  attendees: [], organizer: { emailAddress: { address: ME, name: 'Tom' } }, responseStatus: { response: 'organizer' }, location: { displayName: '' }, ...extra })
const guest = (address: string, name = '') => ({ emailAddress: { address, name }, status: { response: 'none' } })

beforeEach(async () => {
  setLaterHook(() => {})
  resetChatModel()
  hits = []
  calendar = []
  await q(`INSERT INTO ms_tokens (owner, account, access_token, refresh_token, expires_at) VALUES ('owner', $1, $2, $3, now() + interval '1 hour')`,
    [ME, encrypt('graph-token'), encrypt('refresh')])
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
    const url = new URL(input)
    const method = init.method || 'GET'
    const h = { method, path: url.pathname, query: url.searchParams, body: init.body ? JSON.parse(init.body) : null }
    hits.push(h)
    const id = decodeURIComponent(url.pathname.split('/me/events/')[1]?.split('/')[0] || '')
    if (method === 'GET' && url.pathname.endsWith('/me/calendarView')) return Response.json({ value: calendar })
    if (method === 'GET' && id) { const e = calendar.find((x) => x.id === id); return e ? Response.json(e) : new Response('{}', { status: 404 }) }
    if (method === 'POST' && url.pathname.endsWith('/me/events')) return Response.json({ id: `new-${hits.length}`, webLink: 'https://outlook/e' })
    if (method === 'POST' && url.pathname.endsWith('/me/messages')) return Response.json({ id: 'd1', webLink: 'https://outlook/d1' })
    if (method === 'POST' && /\/(accept|tentativelyAccept|decline)$/.test(url.pathname)) return new Response(null, { status: 202 })
    if (method === 'PATCH' || method === 'DELETE') return new Response(null, { status: 204 })
    return new Response(JSON.stringify({ error: `no fake for ${method} ${url.pathname}` }), { status: 404 })
  }))
})
afterEach(() => { setModelTransport(null); setLaterHook(null) })

const changed = () => hits.filter((h) => h.method !== 'GET').map((h) => `${h.method} ${h.path.replace(/^\/v1\.0/, '')}`)

describe('checking the diary', () => {
  it('finds every kind of problem, worked out in code', () => {
    const events = [
      ev('a', 'Board prep', '2030-01-07T08:00', '2030-01-07T09:30'),
      ev('b', 'Bentleys review', '2030-01-07T09:00', '2030-01-07T10:00', { location: { displayName: 'Bentleys, Mayfair' }, attendees: [guest('sam@bentleys.co')] }),
      ev('c', 'Corrigans', '2030-01-07T10:15', '2030-01-07T11:00', { location: { displayName: 'Corrigans, Soho' }, attendees: [guest('a@c.co')] }),
      ev('d1', 'Calls 1', '2030-01-08T09:00', '2030-01-08T10:00'), ev('d2', 'Calls 2', '2030-01-08T10:05', '2030-01-08T11:00'),
      ev('d3', 'Calls 3', '2030-01-08T11:00', '2030-01-08T12:30'),
      ev('e', 'Supplier lunch', '2030-01-09T12:00', '2030-01-09T13:00', { attendees: [guest('x@y.co')] }),
      ev('f', 'Team social', '2030-01-09T18:00', '2030-01-09T20:00', { isOrganizer: false, responseStatus: { response: 'notResponded' }, organizer: { emailAddress: { name: 'Mandy' } } }),
      ev('g', 'Industry dinner', '2030-01-10T19:00', '2030-01-10T21:00', { isOrganizer: false, responseStatus: { response: 'tentativelyAccepted' }, isOnlineMeeting: true }),
      ev('h', 'Free hold', '2030-01-07T09:15', '2030-01-07T09:45', { showAs: 'free' }),
    ]
    const r = reviewEvents(events, ME, '09:00', '17:30')
    const kinds = r.issues.map((i) => i.kind)
    expect(kinds).toContain('clash')
    expect(r.issues.find((i) => i.kind === 'clash')!.ids).toEqual(['a', 'b']) // the free hold is not a clash
    expect(r.issues.find((i) => i.kind === 'travel_gap')!.detail).toContain('15 minutes to get from Bentleys, Mayfair')
    expect(r.issues.find((i) => i.kind === 'no_break')!.ids).toEqual(['d1', 'd2', 'd3'])
    expect(r.issues.filter((i) => i.kind === 'outside_hours').map((i) => i.ids[0])).toEqual(['a', 'f', 'g'])
    expect(r.issues.find((i) => i.kind === 'no_location')!.ids).toEqual(['e'])
    expect(r.issues.find((i) => i.kind === 'unanswered')!.detail).toContain('Mandy')
    expect(kinds).toContain('tentative')
    expect(r.issues.map((i) => i.when)).toEqual([...r.issues.map((i) => i.when)].sort())
  })

  it('flags a day with no room left', () => {
    const r = reviewEvents([ev('x', 'Offsite', '2030-01-07T09:00', '2030-01-07T17:00')], ME, '09:00', '17:30')
    expect(r.issues.map((i) => i.kind)).toContain('overloaded_day')
  })
})

describe('the calendar agent', () => {
  it('is its own conversation, with its own brief and tools, and reviews the diary', async () => {
    calendar = [ev('a', 'Prep', '2030-01-07T09:00', '2030-01-07T10:00'), ev('b', 'Review', '2030-01-07T09:30', '2030-01-07T10:30')]
    const calls = script({ tool_calls: [{ tool: 'review_calendar', args: { from: '2030-01-07', days: 1 } }] }, { reply: 'One clash on Monday.' })
    const r = await req('POST', '/chats', { message: 'Check Monday', agent: 'calendar' })
    expect(r.data.chat.agent).toBe('calendar')
    expect(calls[0].system).toContain("Tom Stanley's calendar agent")
    expect(calls[0].payload).toMatchObject({ agent: 'calendar' })
    expect(calls[1].messages.at(-1)!.content).toContain('overlaps Review')
    // The conversation stays with the calendar agent.
    const again = script({ reply: 'Done.' })
    await req('POST', '/chats', { message: 'Thanks', chat_id: r.data.chat.id })
    expect(again[0].system).toContain('calendar agent')
    const list = (await req('GET', '/chats')).data
    const cal = list.agents.find((a: any) => a.id === 'calendar').tools.map((t: any) => t.name)
    expect(cal).toEqual(expect.arrayContaining(['calendar_view', 'review_calendar', 'create_event', 'update_event', 'cancel_event', 'respond_to_invite']))
    expect(cal).not.toContain('ask_calendar_agent')
    const mine = list.agents.find((a: any) => a.id === 'aimelia').tools.map((t: any) => t.name)
    expect(mine).toEqual(expect.arrayContaining(['ask_calendar_agent', 'ask_travel_agent']))
    expect(mine).not.toContain('create_event')
  })

  it('adds events with nobody invited, and changes only Tom\'s own solo events', async () => {
    calendar = [
      ev('solo', 'Focus: budget', '2030-01-07T14:00', '2030-01-07T15:00'),
      ev('team', 'Team meeting', '2030-01-07T10:00', '2030-01-07T11:00', { attendees: [guest(ME, 'Tom'), guest('mandy@ws.co', 'Mandy')] }),
      ev('theirs', 'Client call', '2030-01-08T10:00', '2030-01-08T11:00', { isOrganizer: false, organizer: { emailAddress: { name: 'Sam' } } }),
    ]
    const calls = script({ tool_calls: [
      { tool: 'create_event', args: { subject: 'Month-end', start: '2030-01-11T13:00', end: '2030-01-11T17:30' } },
      { tool: 'update_event', args: { id: 'solo', start: '2030-01-07T15:00', end: '2030-01-07T16:00' } },
      { tool: 'update_event', args: { id: 'team', start: '2030-01-07T12:00', end: '2030-01-07T13:00' } },
      { tool: 'cancel_event', args: { id: 'theirs' } },
    ] }, { reply: 'Done what I could.' })
    const r = await req('POST', '/chats', { message: 'Block Friday afternoon, move my focus block, the team meeting and drop the client call', agent: 'calendar' })
    expect(r.data.messages[1].steps.map((s: any) => s.ok)).toEqual([true, true, true, true])
    const created = hits.find((h) => h.method === 'POST' && h.path.endsWith('/me/events'))!.body
    expect(created).toMatchObject({ subject: 'Month-end', start: { dateTime: '2030-01-11T13:00:00', timeZone: 'Europe/London' }, categories: ['Aimelia'] })
    expect(created.attendees).toBeUndefined()
    expect(changed()).toEqual(['POST /me/events', 'PATCH /me/events/solo']) // nothing sent to the team meeting or the client call
    const results = calls[1].messages.at(-1)!.content
    expect(results).toContain('has other people in it (Mandy)')
    expect(results).toContain('organised by Sam')
  })

  it('answers invitations when told, and tells the organiser unless asked not to', async () => {
    calendar = [
      ev('inv', 'Industry dinner', '2030-01-10T19:00', '2030-01-10T21:00', { isOrganizer: false }),
      ev('inv2', 'Drinks', '2030-01-11T18:00', '2030-01-11T19:00', { isOrganizer: false }),
      ev('own', 'My meeting', '2030-01-11T10:00', '2030-01-11T11:00'),
    ]
    script({ tool_calls: [
      { tool: 'respond_to_invite', args: { id: 'inv', response: 'decline', comment: 'Sorry, month-end.' } },
      { tool: 'respond_to_invite', args: { id: 'inv2', response: 'tentative', notify_organiser: false } },
      { tool: 'respond_to_invite', args: { id: 'own', response: 'accept' } },
    ] }, { reply: 'Answered.' })
    await req('POST', '/chats', { message: 'Decline the dinner, tentative on drinks but do not tell them', agent: 'calendar' })
    const sent = hits.filter((h) => h.method === 'POST')
    expect(sent.map((h) => [h.path.split('/').slice(-2).join('/'), h.body])).toEqual([
      ['inv/decline', { comment: 'Sorry, month-end.', sendResponse: true }],
      ['inv2/tentativelyAccept', { comment: '', sendResponse: false }],
    ])
  })

  it('finds free time in working hours around what is booked', async () => {
    calendar = [ev('a', 'Morning', '2030-01-07T09:00', '2030-01-07T12:00'), ev('b', 'Afternoon', '2030-01-07T13:00', '2030-01-07T17:30')]
    const calls = script({ tool_calls: [{ tool: 'find_free_time', args: { minutes: 60, from: '2030-01-07', to: '2030-01-08', count: 2 } }] }, { reply: 'Two slots.' })
    await req('POST', '/chats', { message: 'Find an hour', agent: 'calendar' })
    const res = calls[1].messages.at(-1)!.content
    expect(res).toContain('2030-01-07T12:00')
    expect(res).toContain('2030-01-08T09:00')
  })

  it('keeps calendar changes to the per-message limit', async () => {
    calendar = ['a', 'b', 'c', 'd'].map((id, i) => ev(id, `Block ${id}`, `2030-01-07T0${i + 1}:00`, `2030-01-07T0${i + 1}:30`))
    const r = await (script({ tool_calls: ['a', 'b', 'c', 'd'].map((id) => ({ tool: 'cancel_event', args: { id } })) }, { reply: 'Three done.' }),
      req('POST', '/chats', { message: 'Cancel all four', agent: 'calendar' }))
    expect(r.data.messages[1].steps.map((s: any) => s.ok)).toEqual([true, true, true, false])
    expect(hits.filter((h) => h.method === 'DELETE')).toHaveLength(3)
  })
})

describe('the travel agent', () => {
  it('keeps the trip, holds the travel time, and drafts the booking request without sending or paying', async () => {
    let tripId = ''
    setModelTransport(async (c) => {
      const step = (c.payload as any).step
      const last = c.messages.at(-1)!.content
      if (step === 0) return JSON.stringify({ tool_calls: [{ tool: 'save_trip', args: { title: 'Manchester: Bentleys board', destination: 'Manchester', depart_date: '2030-01-09', return_date: '2030-01-09', itinerary: 'Euston 07:30 to Piccadilly 09:41. Card 4111 1111 1111 1111 on file.' } }] })
      if (step === 1) {
        tripId = JSON.parse(JSON.parse(last.slice(last.indexOf('['))) [0].result).trip.id
        return JSON.stringify({ tool_calls: [
          { tool: 'hold_travel_time', args: { trip_id: tripId, subject: 'Train: London Euston 07:30 to Manchester Piccadilly 09:41', start: '2030-01-09T07:30', end: '2030-01-09T09:41' } },
          { tool: 'request_booking', args: { trip_id: tripId, to: 'jo@williamsstanley.co', body: 'Hi Jo,\n\nPlease book the 07:30 Euston to Piccadilly, first class, 9 January.\n\nBest regards,\nTom' } },
          { tool: 'request_booking', args: { trip_id: tripId, to: '07700 900123', body: 'x' } },
        ] })
      }
      return JSON.stringify({ reply: 'Held and drafted for Jo.' })
    })
    const r = await req('POST', '/chats', { message: 'Get me to Manchester for the Bentleys board on the 9th, Jo books my travel', agent: 'travel' })
    expect(r.data.messages[1].steps.map((s: any) => [s.tool, s.ok])).toEqual([['save_trip', true], ['hold_travel_time', true], ['request_booking', true], ['request_booking', true]])
    const trip = (await one(`SELECT * FROM trips`))!
    expect(trip.itinerary).toContain('[number removed]')
    expect(trip.itinerary).not.toContain('4111')
    expect(trip.status).toBe('requested')
    expect(trip.holds).toHaveLength(1)
    const event = hits.find((h) => h.method === 'POST' && h.path.endsWith('/me/events'))!.body
    expect(event.categories).toEqual(['Aimelia', 'Travel'])
    expect(event.attendees).toBeUndefined()
    const drafts = hits.filter((h) => h.method === 'POST' && h.path.endsWith('/me/messages'))
    expect(drafts).toHaveLength(1) // the phone number was refused
    expect(drafts[0].body.toRecipients).toEqual([{ emailAddress: { address: 'jo@williamsstanley.co' } }])
    expect(hits.some((h) => /send/i.test(h.path))).toBe(false)
    expect((await req('GET', '/trips')).data.trips[0]).toMatchObject({ title: 'Manchester: Bentleys board', status: 'requested' })
  })

  it('records a confirmed booking on the trip', async () => {
    const [t] = await q(`INSERT INTO trips (title, status) VALUES ('Leeds', 'requested') RETURNING id`)
    script({ tool_calls: [{ tool: 'save_trip', args: { id: t.id, status: 'booked', add_booking: 'LNER 08:03 Kings Cross to Leeds, ref ABC123, £142.50' } }] }, { reply: 'Recorded.' })
    await req('POST', '/chats', { message: 'The confirmation came in', agent: 'travel' })
    const row = (await one(`SELECT status, bookings FROM trips WHERE id = $1`, [t.id]))!
    expect(row.status).toBe('booked')
    expect(row.bookings[0].detail).toContain('ref ABC123')
  })
})

describe('Aimelia hands work to her specialists', () => {
  it('passes the request on, shows the specialist\'s steps, and reports back', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const calls = script(
      { tool_calls: [{ tool: 'ask_travel_agent', args: { brief: 'Trip to Leeds on 2030-01-14 for the Corrigans review; back the same day' } }] },
      { tool_calls: [{ tool: 'save_trip', args: { title: 'Leeds: Corrigans review', depart_date: '2030-01-14' } }] },
      { reply: 'Two trains each way; recommend the 07:03.' },
      { reply: 'The travel agent recommends the 07:03 from Kings Cross.' })
    const r = await req('POST', '/chats', { message: 'Sort my trip to Leeds on the 14th' })
    expect(r.data.messages[1].content).toContain('07:03')
    expect(r.data.messages[1].steps.map((s: any) => [s.tool, s.by ?? null])).toEqual([['ask_travel_agent', null], ['save_trip', 'Travel agent']])
    expect(calls[1].system).toContain("Tom Stanley's travel agent")
    expect(calls[1].messages[0].content).toContain('Aimelia passes on this request from Tom')
    expect(calls[1].payload).toMatchObject({ agent: 'travel', delegated: true })
    expect(calls[3].messages.at(-1)!.content).toContain('Travel agent')
    expect(await one(`SELECT title FROM trips`)).toEqual({ title: 'Leeds: Corrigans review' })
  })

  it('shares the change limits with the specialist, so handing over cannot double them', async () => {
    calendar = ['a', 'b', 'c'].map((id, i) => ev(id, `Block ${id}`, `2030-01-07T0${i + 1}:00`, `2030-01-07T0${i + 1}:30`))
    script(
      { tool_calls: [{ tool: 'ask_calendar_agent', args: { brief: 'Cancel blocks a, b, c' } }, { tool: 'ask_calendar_agent', args: { brief: 'Cancel a, b, c again' } }, { tool: 'ask_calendar_agent', args: { brief: 'Third' } }] },
      { tool_calls: ['a', 'b', 'c'].map((id) => ({ tool: 'cancel_event', args: { id } })) },
      { reply: 'Cancelled.' })
    const r = await req('POST', '/chats', { message: 'Clear my blocks' })
    const steps = r.data.messages[1].steps
    expect(steps.filter((s: any) => s.tool === 'ask_calendar_agent').map((s: any) => s.ok)).toEqual([true, true, false]) // two hand-overs a message
    expect(hits.filter((h) => h.method === 'DELETE').length).toBeLessThanOrEqual(3)
  })

  it('offers no calendar agent while Microsoft 365 is not connected', async () => {
    await q(`DELETE FROM ms_tokens`)
    const list = (await req('GET', '/chats')).data
    expect(list.agents.find((a: any) => a.id === 'calendar').tools).toEqual(expect.not.arrayContaining([expect.objectContaining({ name: 'create_event' })]))
    expect(list.agents.find((a: any) => a.id === 'aimelia').tools.map((t: any) => t.name)).not.toContain('ask_calendar_agent')
  })
})
