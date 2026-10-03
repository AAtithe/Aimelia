/**
 * The calendar agent's tools: read Tom's Outlook calendar, check it for problems, find free time, and change it.
 *
 * What it may change, enforced here whatever the model decides:
 * - create events on Tom's own calendar with nobody else invited (blocks, holds, reminders), tagged "Aimelia"
 * - move, rename or cancel an event only when Tom organised it and nobody else is invited, so no update ever reaches anyone
 * - answer an invitation (accept, tentative, decline) when Tom says so; the organiser gets Outlook's usual reply unless
 *   Tom says not to tell them. That reply is the only thing the calendar agent sends to another person.
 * A meeting with other people in it is never moved or cancelled here: the agent drafts an email proposing the change.
 * Times are London wall-clock, "YYYY-MM-DDTHH:MM".
 */
import { env } from '../env'
import { connection, graph } from '../microsoft'
import { addDays, londonParts } from '../dates'
import { findSlot } from '../agents/calendarBlocks'
import { londonToIso } from '../email/briefs'
import { getPipeline } from '../agents/orchestrator'
import { clip, microsoftLive, type Args, type Tool } from './common'

const FIELDS = 'id,subject,start,end,location,attendees,organizer,isOrganizer,responseStatus,responseRequested,showAs,isOnlineMeeting,isAllDay,isCancelled,categories,webLink'
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const YMD = /^\d{4}-\d{2}-\d{2}$/
const SHOW_AS = ['free', 'tentative', 'busy', 'oof', 'workingElsewhere']
const RESPONSES: Record<string, string> = { accept: 'accept', tentative: 'tentativelyAccept', decline: 'decline' }

// Wall-clock minutes, for gaps and overlaps (the same trick as calendarBlocks).
const toMin = (s: string) => Date.parse(`${s.slice(0, 16)}:00Z`) / 60000
const headers = () => ({ Prefer: `outlook.timezone="${env.timezone()}"` })
const wall = (v: string | undefined) => String(v || '').slice(0, 16)

export type CalEvent = Record<string, any>

/** Events between two London dates (inclusive), cancelled ones left out. */
export async function eventsBetween(from: string, to: string): Promise<CalEvent[]> {
  const res = await graph<{ value: CalEvent[] }>('GET', '/me/calendarView', {
    headers: headers(),
    query: { startDateTime: londonToIso(`${from}T00:00:00`)!, endDateTime: londonToIso(`${addDays(to, 1)}T00:00:00`)!, $select: FIELDS, $orderby: 'start/dateTime', $top: 250 },
  })
  return (res.value || []).filter((e) => !e.isCancelled)
}

const me = async () => String((await connection()).account || '').toLowerCase()
const othersIn = (e: CalEvent, mine: string) => (e.attendees || [])
  .map((a: any) => ({ name: a.emailAddress?.name || '', email: String(a.emailAddress?.address || '').toLowerCase(), response: a.status?.response || '' }))
  .filter((a: any) => a.email && a.email !== mine)

function eventLine(e: CalEvent, mine: string) {
  const others = othersIn(e, mine)
  return {
    id: e.id, subject: e.subject || '(no subject)', start: wall(e.start?.dateTime), end: wall(e.end?.dateTime), all_day: !!e.isAllDay,
    location: e.location?.displayName || '', online: !!e.isOnlineMeeting, show_as: e.showAs, categories: e.categories || [],
    tom_organised: !!e.isOrganizer, organiser: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || '',
    tom_response: e.isOrganizer ? 'organiser' : e.responseStatus?.response || 'none',
    others: others.slice(0, 15), others_count: others.length,
  }
}

/** A date range from the arguments: from (default today) to to (default from + days), at most 31 days. */
function range(a: Args, days = 7): [string, string] {
  const today = londonParts().date
  const from = YMD.test(String(a.from || '')) ? String(a.from) : today
  let to = YMD.test(String(a.to || '')) ? String(a.to) : addDays(from, Math.min(Math.max(Number(a.days) || days, 1), 31) - 1)
  if (to < from) to = from
  if (toMin(`${to}T00:00`) - toMin(`${from}T00:00`) > 30 * 1440) to = addDays(from, 30)
  return [from, to]
}

function needWall(v: unknown, name: string) {
  const s = String(v || '').trim().replace(' ', 'T').slice(0, 16)
  if (!WALL.test(s)) throw new Error(`${name} must be a London time as YYYY-MM-DDTHH:MM`)
  return s
}

/** The problems in a run of events, worked out in code so nothing is missed. */
export function reviewEvents(events: CalEvent[], mine: string, workStart: string, workEnd: string) {
  const timed = events.filter((e) => !e.isAllDay).map((e) => ({ e, s: wall(e.start?.dateTime), f: wall(e.end?.dateTime) }))
    .sort((x, y) => x.s.localeCompare(y.s))
  const busy = timed.filter((x) => !['free', 'workingElsewhere'].includes(x.e.showAs))
  const name = (e: CalEvent) => e.subject || '(no subject)'
  const issues: { kind: string; when: string; detail: string; ids: string[] }[] = []

  for (let i = 0; i < busy.length; i++) {
    for (let j = i + 1; j < busy.length && busy[j].s < busy[i].f; j++) {
      issues.push({ kind: 'clash', when: busy[j].s, detail: `${name(busy[i].e)} (${busy[i].s.slice(11)}-${busy[i].f.slice(11)}) overlaps ${name(busy[j].e)} (${busy[j].s.slice(11)}-${busy[j].f.slice(11)})`, ids: [busy[i].e.id, busy[j].e.id] })
    }
  }
  // Three hours or more of meetings with under ten minutes between them.
  let run: typeof busy = []
  const flush = () => {
    if (run.length > 1 && toMin(run.at(-1)!.f) - toMin(run[0].s) >= 180) {
      issues.push({ kind: 'no_break', when: run[0].s, detail: `${run.length} meetings back to back from ${run[0].s.slice(11)} to ${run.at(-1)!.f.slice(11)} with no break`, ids: run.map((x) => x.e.id) })
    }
    run = []
  }
  for (const x of busy) {
    if (run.length && (x.s.slice(0, 10) !== run.at(-1)!.f.slice(0, 10) || toMin(x.s) - toMin(run.at(-1)!.f) >= 10)) flush()
    run.push(x)
  }
  flush()
  for (let i = 1; i < busy.length; i++) {
    const a = busy[i - 1], b = busy[i]
    const la = (a.e.location?.displayName || '').trim(), lb = (b.e.location?.displayName || '').trim()
    if (a.s.slice(0, 10) === b.s.slice(0, 10) && !a.e.isOnlineMeeting && !b.e.isOnlineMeeting && la && lb && la.toLowerCase() !== lb.toLowerCase()) {
      const gap = toMin(b.s) - toMin(a.f)
      if (gap >= 0 && gap < 30) issues.push({ kind: 'travel_gap', when: a.f, detail: `${gap} minutes to get from ${la} (${name(a.e)}) to ${lb} (${name(b.e)})`, ids: [a.e.id, b.e.id] })
    }
  }
  for (const x of busy) {
    const wd = (new Date(`${x.s.slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7
    if (wd < 5 && (x.s.slice(11) < workStart || x.f.slice(11) > workEnd)) {
      issues.push({ kind: 'outside_hours', when: x.s, detail: `${name(x.e)} runs ${x.s.slice(11)}-${x.f.slice(11)}, outside working hours ${workStart}-${workEnd}`, ids: [x.e.id] })
    }
    if (othersIn(x.e, mine).length && !x.e.isOnlineMeeting && !(x.e.location?.displayName || '').trim()) {
      issues.push({ kind: 'no_location', when: x.s, detail: `${name(x.e)} has other people in it but no location or online link`, ids: [x.e.id] })
    }
  }
  for (const x of timed) {
    const r = x.e.responseStatus?.response
    if (!x.e.isOrganizer && x.e.responseRequested !== false && (r === 'notResponded' || r === 'none')) {
      issues.push({ kind: 'unanswered', when: x.s, detail: `Invitation from ${x.e.organizer?.emailAddress?.name || 'someone'} not answered: ${name(x.e)}`, ids: [x.e.id] })
    } else if (r === 'tentativelyAccepted') {
      issues.push({ kind: 'tentative', when: x.s, detail: `Still tentative: ${name(x.e)}`, ids: [x.e.id] })
    }
  }
  const byDay: Record<string, number> = {}
  for (const x of busy) byDay[x.s.slice(0, 10)] = (byDay[x.s.slice(0, 10)] || 0) + toMin(x.f) - toMin(x.s)
  const dayLength = toMin(`2000-01-01T${workEnd}`) - toMin(`2000-01-01T${workStart}`)
  for (const [day, mins] of Object.entries(byDay)) {
    if (mins > dayLength - 60) issues.push({ kind: 'overloaded_day', when: `${day}T00:00`, detail: `${Math.round(mins / 6) / 10} hours of meetings on ${day}, leaving under an hour of the working day`, ids: [] })
  }
  issues.sort((x, y) => x.when.localeCompare(y.when))
  return { meetings: busy.length, hours_in_meetings: Math.round(busy.reduce((n, x) => n + toMin(x.f) - toMin(x.s), 0) / 6) / 10, issues }
}

/** Tom's own event with nobody else in it, or why it may not be changed here. */
async function ownSolo(id: string): Promise<{ e: CalEvent } | { refused: string }> {
  const e = await graph<CalEvent>('GET', `/me/events/${encodeURIComponent(id)}`, { headers: headers(), query: { $select: FIELDS } })
  const others = othersIn(e, await me())
  if (!e.isOrganizer) return { refused: `Not changed: ${e.subject || 'that meeting'} was organised by ${e.organizer?.emailAddress?.name || 'someone else'}. Tom can accept, decline or propose a new time; draft an email to the organiser if he wants it moved.` }
  if (others.length) {
    return { refused: `Not changed: ${e.subject || 'that meeting'} has other people in it (${others.slice(0, 5).map((o: any) => o.name || o.email).join(', ')}), and changing it would send them an update. Draft an email proposing the change instead, or Tom can change it in Outlook.` }
  }
  return { e }
}

export const CALENDAR_TOOLS: Record<string, Tool> = {
  calendar_view: {
    about: 'Tom\'s calendar between two dates, in London time: every event with its id, who organised it, who else is in it, his response, location and whether it is online',
    args: '{"from": "YYYY-MM-DD (default today)", "to": "YYYY-MM-DD", "days": 7}',
    available: microsoftLive,
    run: async (a) => {
      const [from, to] = range(a)
      const mine = await me()
      return { from, to, events: (await eventsBetween(from, to)).map((e) => eventLine(e, mine)) }
    },
  },
  review_calendar: {
    about: 'Check Tom\'s calendar for problems, worked out exactly: clashes, three hours or more with no break, too little time to travel between places, meetings outside working hours, meetings with no location or link, invitations not answered, tentative ones, days with no room left',
    args: '{"from": "YYYY-MM-DD (default today)", "days": 7}',
    available: microsoftLive,
    run: async (a) => {
      const [from, to] = range(a)
      const p = await getPipeline()
      const events = await eventsBetween(from, to)
      return { from, to, working_hours: `${p.work_start}-${p.work_end}`, ...reviewEvents(events, await me(), p.work_start, p.work_end) }
    },
  },
  find_free_time: {
    about: 'Free slots in Tom\'s working hours (weekdays) of a given length, earliest first',
    args: '{"minutes": 60, "from": "YYYY-MM-DD (default today)", "to": "YYYY-MM-DD", "count": 3}',
    available: microsoftLive,
    run: async (a) => {
      const minutes = Math.min(Math.max(Number(a.minutes) || 60, 15), 600)
      const [from, to] = range(a, 14)
      const p = await getPipeline()
      const busy = (await eventsBetween(from, to)).filter((e) => !e.isAllDay && !['free', 'workingElsewhere'].includes(e.showAs))
        .map((e) => [wall(e.start?.dateTime), wall(e.end?.dateTime)] as [string, string])
      const now = londonParts()
      let cursor = from > now.date ? `${from}T00:00` : `${now.date}T${now.time}`
      const slots: { start: string; end: string }[] = []
      const days = Math.round((toMin(`${to}T00:00`) - toMin(`${from}T00:00`)) / 1440) + 1
      while (slots.length < Math.min(Math.max(Number(a.count) || 3, 1), 10)) {
        const s = findSlot(busy, cursor, minutes, p.work_start || '09:00', p.work_end || '17:30', days)
        if (!s || s[0].slice(0, 10) > to) break
        slots.push({ start: s[0], end: s[1] })
        busy.push(s) // the next slot starts after this one
        cursor = s[1]
      }
      return slots.length ? { minutes, slots } : `No free ${minutes}-minute slot in working hours between ${from} and ${to}.`
    },
  },
  create_event: {
    about: 'Put an event on Tom\'s own calendar with nobody else invited: a block, a hold, a reminder, a personal appointment. Only when Tom asks',
    args: '{"subject": "...", "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "location": "optional", "notes": "optional", "show_as": "busy|tentative|free|oof|workingElsewhere"}',
    available: microsoftLive,
    run: async (a) => createEvent(a, ['Aimelia']),
  },
  update_event: {
    about: 'Move, rename or relocate an event Tom organised that has nobody else in it. Refused for meetings with other people: draft an email proposing the change instead. Only when Tom asks',
    args: '{"id": "event id from calendar_view", "subject": "optional", "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "location": "optional", "show_as": "optional"}',
    available: microsoftLive,
    run: async (a) => {
      const own = await ownSolo(String(a.id || ''))
      if ('refused' in own) return own.refused
      const tz = env.timezone()
      const patch: Record<string, unknown> = {}
      if (typeof a.subject === 'string' && a.subject.trim()) patch.subject = a.subject.trim().slice(0, 255)
      if (a.start) patch.start = { dateTime: `${needWall(a.start, 'start')}:00`, timeZone: tz }
      if (a.end) patch.end = { dateTime: `${needWall(a.end, 'end')}:00`, timeZone: tz }
      if (typeof a.location === 'string') patch.location = { displayName: a.location }
      if (SHOW_AS.includes(a.show_as)) patch.showAs = a.show_as
      const start = a.start ? needWall(a.start, 'start') : wall(own.e.start?.dateTime)
      const end = a.end ? needWall(a.end, 'end') : wall(own.e.end?.dateTime)
      if (end <= start) return 'Not changed: the end must be after the start.'
      if (!Object.keys(patch).length) return 'Nothing to change.'
      await graph('PATCH', `/me/events/${encodeURIComponent(own.e.id)}`, { headers: headers(), body: patch })
      return { updated: true, subject: patch.subject ?? own.e.subject, start, end, changed: Object.keys(patch) }
    },
  },
  cancel_event: {
    about: 'Delete an event Tom organised that has nobody else in it. Refused for meetings with other people. Only when Tom asks',
    args: '{"id": "event id from calendar_view"}',
    available: microsoftLive,
    run: async (a) => {
      const own = await ownSolo(String(a.id || ''))
      if ('refused' in own) return own.refused
      await graph('DELETE', `/me/events/${encodeURIComponent(own.e.id)}`)
      return { cancelled: true, subject: own.e.subject, was: `${wall(own.e.start?.dateTime)} to ${wall(own.e.end?.dateTime).slice(11)}` }
    },
  },
  respond_to_invite: {
    about: 'Accept, tentatively accept or decline an invitation, when Tom says so. The organiser gets Outlook\'s usual reply, with a short note if given, unless notify_organiser is false',
    args: '{"id": "event id", "response": "accept|tentative|decline", "comment": "optional short note to the organiser", "notify_organiser": true}',
    available: microsoftLive,
    run: async (a) => {
      const action = RESPONSES[String(a.response || '')]
      if (!action) return 'Not answered: response must be accept, tentative or decline.'
      const e = await graph<CalEvent>('GET', `/me/events/${encodeURIComponent(String(a.id || ''))}`, { headers: headers(), query: { $select: FIELDS } })
      if (e.isOrganizer) return `Not answered: ${e.subject || 'that'} is Tom's own meeting.`
      const sendResponse = a.notify_organiser !== false
      await graph('POST', `/me/events/${encodeURIComponent(e.id)}/${action}`, { body: { comment: clip(a.comment || '', 500).replace(/ \.\.\.$/, ''), sendResponse } })
      return { answered: a.response, subject: e.subject, when: wall(e.start?.dateTime), organiser_told: sendResponse }
    },
  },
}

/** A new event on Tom's calendar, never with attendees, so nobody is invited. */
export async function createEvent(a: Args, categories: string[], body = '') {
  const subject = String(a.subject || '').trim().slice(0, 255)
  if (!subject) return 'Not added: it needs a subject.'
  const start = needWall(a.start, 'start'), end = needWall(a.end, 'end')
  if (end <= start) return 'Not added: the end must be after the start.'
  const tz = env.timezone()
  const ev = await graph<CalEvent>('POST', '/me/events', {
    headers: headers(), body: {
      subject, start: { dateTime: `${start}:00`, timeZone: tz }, end: { dateTime: `${end}:00`, timeZone: tz },
      ...(a.location ? { location: { displayName: String(a.location).slice(0, 255) } } : {}),
      body: { contentType: 'Text', content: [String(a.notes || ''), body].filter(Boolean).join('\n\n') || 'Added by Aimelia' },
      showAs: SHOW_AS.includes(a.show_as) ? a.show_as : 'busy', categories, isReminderOn: true, reminderMinutesBeforeStart: 15,
    },
  })
  return { added: true, id: ev.id, subject, start, end, link: ev.webLink || null }
}
