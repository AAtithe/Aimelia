/**
 * Calendar dates as YYYY-MM-DD strings, worked out in London time. Plain strings compare
 * correctly and never shift across timezones the way Date objects at midnight do.
 */
import { env } from './env'

export type Ymd = string

export function londonParts(now: Date = new Date()) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: env.timezone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    weekday: 'short', hour12: false,
  })
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]))
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday)
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`, weekday }
}

export const londonToday = (now?: Date): Ymd => londonParts(now).date

function toUtc(d: Ymd): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}
const fromUtc = (d: Date): Ymd => d.toISOString().slice(0, 10)

export const isYmd = (v: unknown): v is Ymd => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(toUtc(v).getTime())
export const addDays = (d: Ymd, n: number): Ymd => fromUtc(new Date(toUtc(d).getTime() + n * 86400000))
/** 0 = Monday ... 6 = Sunday */
export const weekday = (d: Ymd): number => (toUtc(d).getUTCDay() + 6) % 7
export const daysBetween = (a: Ymd, b: Ymd): number => Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86400000)

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthDay(year: number, month: number, dayOfMonth: number): Ymd {
  const last = lastDayOfMonth(year, month)
  const day = dayOfMonth === -1 ? last : Math.min(Math.max(dayOfMonth, 1), last)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function addMonths(d: Ymd, months: number, dayOfMonth: number): Ymd {
  const [y, m] = d.split('-').map(Number)
  const index = m - 1 + months
  return monthDay(y + Math.floor(index / 12), (((index % 12) + 12) % 12) + 1, dayOfMonth)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
/** House date format: 2 Oct 2026. */
export function ukDate(d: Ymd): string {
  const [y, m, day] = d.split('-').map(Number)
  return `${day} ${MONTHS[m - 1]} ${y}`
}
