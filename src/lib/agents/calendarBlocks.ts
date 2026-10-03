/**
 * Book focus time for work only Tom can do. Reads only start, end and busy state of existing
 * events (never subjects, bodies or attendees), finds the first free slot in working hours,
 * and creates a "Focus" event. All slot maths is on London wall-clock time ("YYYY-MM-DDTHH:MM").
 */
import { env } from '../env'
import { graph } from '../microsoft'
import { londonParts } from '../dates'

export class CalendarError extends Error {}
type Interval = [string, string]

// Wall-clock strings mapped to minutes, treating them as UTC purely for arithmetic.
const toMin = (s: string) => Date.parse(`${s.slice(0, 16)}:00Z`) / 60000
const fromMin = (m: number) => new Date(m * 60000).toISOString().slice(0, 16)
const roundUp15 = (m: number) => Math.ceil(m / 15) * 15

export function findSlot(busy: Interval[], startFrom: string, minutes: number, workStart: string, workEnd: string, days = 10): Interval | null {
  const spans = busy.map(([a, b]) => [toMin(a), toMin(b)] as [number, number]).sort((x, y) => x[0] - y[0])
  const t = roundUp15(toMin(startFrom))
  let day = fromMin(t).slice(0, 10)
  for (let i = 0; i < days * 2; i++) {
    const wd = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
    if (wd < 5) {
      let cursor = Math.max(toMin(`${day}T${workStart}`), t)
      const close = toMin(`${day}T${workEnd}`)
      for (const [bs, be] of spans) {
        if (be <= cursor || bs >= close) continue
        if (bs - cursor >= minutes) return [fromMin(cursor), fromMin(cursor + minutes)]
        cursor = roundUp15(Math.max(cursor, be))
      }
      if (close - cursor >= minutes) return [fromMin(cursor), fromMin(cursor + minutes)]
    }
    day = fromMin(toMin(`${day}T12:00`) + 1440).slice(0, 10)
  }
  return null
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** on: book on that day only (the day it is planned for), from its start or from now if that is later. */
export async function bookFocus(o: { title: string; summary: string; minutes: number; workStart: string; workEnd: string; now?: Date; on?: string }) {
  const now = o.now ?? new Date()
  const tz = env.timezone()
  const { date, time } = londonParts(now)
  const headers = { Prefer: `outlook.timezone="${tz}"` }
  // UTC instants with Z for the window, so it is never read in the wrong zone.
  const view = await graph<{ value: any[] }>('GET', '/me/calendarView', {
    headers, query: { startDateTime: now.toISOString(), endDateTime: new Date(now.getTime() + 21 * 86400000).toISOString(),
      $select: 'start,end,showAs,isCancelled', $top: 500 },
  })
  const busy = (view.value || []).filter((e) => !e.isCancelled && !['free', 'workingElsewhere'].includes(e.showAs))
    .map((e) => [String(e.start.dateTime).slice(0, 16), String(e.end.dateTime).slice(0, 16)] as Interval)
  const from = o.on && o.on > date ? `${o.on}T00:00` : `${date}T${time}`
  const slot = findSlot(busy, from, o.minutes, o.workStart || '09:00', o.workEnd || '17:30')
  if (o.on && (!slot || slot[0].slice(0, 10) !== o.on)) throw new CalendarError(`No free ${o.minutes}-minute slot in working hours on ${o.on}. Pick another day or a shorter block.`)
  if (!slot) throw new CalendarError(`No free ${o.minutes}-minute slot in working hours over the next two weeks.`)
  const event = await graph('POST', '/me/events', {
    headers, body: {
      subject: `Focus: ${o.title}`.slice(0, 255),
      body: { contentType: 'HTML', content: `<p>${esc(o.summary || o.title)}</p><p><a href="${esc(env.appUrl())}/tasks">Open in Aimelia</a></p>` },
      start: { dateTime: `${slot[0]}:00`, timeZone: tz }, end: { dateTime: `${slot[1]}:00`, timeZone: tz },
      showAs: 'busy', categories: ['Aimelia'], isReminderOn: true, reminderMinutesBeforeStart: 5,
    },
  })
  return { id: event.id as string, start: slot[0], end: slot[1], link: (event.webLink as string) || null }
}

const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
const plusHour = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * An appointment in Tom's calendar that came out of the work: a flight, a meeting, a deadline. Times are London
 * wall-clock; a timed one with no end runs an hour, an all-day one is shown as free so it does not block the day.
 */
export async function addToDiary(o: { subject: string; date: string; start?: string; end?: string; all_day: boolean; location: string; notes: string }) {
  const tz = env.timezone()
  const start = o.all_day ? `${o.date}T00:00` : `${o.date}T${o.start}`
  const end = o.all_day ? `${nextDay(o.date)}T00:00` : `${o.date}T${o.end || plusHour(o.start!)}`
  const event = await graph('POST', '/me/events', {
    headers: { Prefer: `outlook.timezone="${tz}"` },
    body: {
      subject: o.subject.slice(0, 255),
      body: { contentType: 'HTML', content: `<p style="white-space:pre-wrap">${esc(o.notes)}</p><p><a href="${esc(env.appUrl())}/tasks">Open in Aimelia</a></p>` },
      start: { dateTime: `${start}:00`, timeZone: tz }, end: { dateTime: `${end}:00`, timeZone: tz }, isAllDay: o.all_day,
      ...(o.location ? { location: { displayName: o.location } } : {}),
      showAs: o.all_day ? 'free' : 'busy', categories: ['Aimelia'], isReminderOn: true, reminderMinutesBeforeStart: o.all_day ? 1080 : 30,
    },
  })
  return { id: event.id as string, start, end, link: (event.webLink as string) || null }
}
