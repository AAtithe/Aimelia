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

export async function bookFocus(o: { title: string; summary: string; minutes: number; workStart: string; workEnd: string; now?: Date }) {
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
  const slot = findSlot(busy, `${date}T${time}`, o.minutes, o.workStart || '09:00', o.workEnd || '17:30')
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
