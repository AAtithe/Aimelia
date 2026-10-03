/**
 * The travel agent's tools: keep trips, hold travel time in Tom's calendar, and ask whoever books to book.
 *
 * Aimelia has no booking or payment account, so the travel agent never buys anything and never says it has. It
 * researches real options (web search), plans door to door, keeps the plan as a trip, holds the travel time in the
 * calendar, and drafts the booking request in Outlook for Tom to send. When a confirmation email arrives it records
 * the booking on the trip. Card and passport numbers are never kept.
 */
import { iso, json, one, q, type Row } from '../db'
import { createDraft } from '../email/drafting'
import { recipientProblem } from '../guard'
import { createEvent } from './calendar'
import { clip, microsoftLive, type Tool } from './common'

const STATUSES = ['idea', 'planned', 'requested', 'booked', 'done', 'cancelled']
const YMD = /^\d{4}-\d{2}-\d{2}$/
// A long run of digits (a card or passport number) never goes into a trip.
const SENSITIVE = /\b(?:\d[ -]?){12,19}\b|\b[A-Z]?\d{9}\b/g
const scrub = (t: unknown) => String(t ?? '').replace(SENSITIVE, '[number removed]')

export const tripOut = (t: Row) => ({ id: t.id, title: t.title, destination: t.destination, purpose: t.purpose, depart_date: t.depart_date,
  return_date: t.return_date, status: t.status, itinerary: t.itinerary, bookings: t.bookings || [], holds: t.holds || [], notes: t.notes,
  updated_at: iso(t.updated_at) })

export async function listTrips(includePast = false) {
  const rows = await q(`SELECT * FROM trips WHERE $1 OR (status NOT IN ('done', 'cancelled') AND (coalesce(return_date, depart_date) IS NULL OR coalesce(return_date, depart_date) >= to_char(now(), 'YYYY-MM-DD')))
    ORDER BY depart_date NULLS LAST, created_at DESC LIMIT 30`, [includePast])
  return rows.map(tripOut)
}

export const TRAVEL_TOOLS: Record<string, Tool> = {
  save_trip: {
    about: 'Keep or update a trip: where, when, why, the plan as it stands, its status, and a confirmed booking (from the confirmation email). Save as soon as the trip is agreed in outline, and each time it changes',
    args: '{"id": "trip id to update, or leave out to start one", "title": "...", "destination": "...", "purpose": "...", "depart_date": "YYYY-MM-DD", "return_date": "YYYY-MM-DD", "status": "idea|planned|requested|booked|done|cancelled", "itinerary": "the whole plan, door to door", "add_booking": "one confirmed booking: what, when, reference, cost", "notes": "..."}',
    run: async (a) => {
      const t = a.id ? await one(`SELECT * FROM trips WHERE id::text = $1`, [String(a.id)]) : null
      if (a.id && !t) return 'No trip with that id.'
      const v = {
        title: String(a.title ?? t?.title ?? '').trim().slice(0, 200),
        destination: scrub(a.destination ?? t?.destination ?? '').slice(0, 200),
        purpose: scrub(a.purpose ?? t?.purpose ?? '').slice(0, 500),
        depart_date: YMD.test(String(a.depart_date || '')) ? a.depart_date : t?.depart_date ?? null,
        return_date: YMD.test(String(a.return_date || '')) ? a.return_date : t?.return_date ?? null,
        status: STATUSES.includes(a.status) ? a.status : t?.status ?? 'planned',
        itinerary: scrub(a.itinerary ?? t?.itinerary ?? '').slice(0, 8000),
        notes: scrub(a.notes ?? t?.notes ?? '').slice(0, 4000),
      }
      if (!v.title) return 'Not saved: a trip needs a title.'
      if (v.return_date && v.depart_date && v.return_date < v.depart_date) return 'Not saved: the return is before the departure.'
      const bookings = [...(t?.bookings || []), ...(a.add_booking ? [{ detail: scrub(a.add_booking).slice(0, 500), recorded_at: new Date().toISOString() }] : [])]
      const row = t
        ? await one(`UPDATE trips SET title=$2, destination=$3, purpose=$4, depart_date=$5, return_date=$6, status=$7, itinerary=$8, notes=$9, bookings=$10, updated_at=now() WHERE id=$1 RETURNING *`,
          [t.id, v.title, v.destination, v.purpose, v.depart_date, v.return_date, v.status, v.itinerary, v.notes, json(bookings)])
        : await one(`INSERT INTO trips (title, destination, purpose, depart_date, return_date, status, itinerary, notes, bookings) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [v.title, v.destination, v.purpose, v.depart_date, v.return_date, v.status, v.itinerary, v.notes, json(bookings)])
      return { saved: true, trip: tripOut(row!) }
    },
  },
  list_trips: {
    about: 'Tom\'s trips: coming up, or all of them including past and cancelled ones',
    args: '{"include_past": false}',
    run: async (a) => {
      const trips = await listTrips(!!a.include_past)
      return trips.length ? trips.map((t) => ({ ...t, itinerary: clip(t.itinerary, 1500) })) : 'No trips kept yet.'
    },
  },
  hold_travel_time: {
    about: 'Hold one leg of a journey in Tom\'s calendar (train, flight, drive, transfer, hotel check-in), with nobody invited, tagged Travel. When Tom agrees the plan, or a booking is confirmed',
    args: '{"trip_id": "optional", "subject": "e.g. Train: London Euston 07:30 to Manchester Piccadilly 09:41", "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "location": "where it starts", "notes": "reference, seat, platform"}',
    available: microsoftLive,
    run: async (a) => {
      const trip = a.trip_id ? await one(`SELECT * FROM trips WHERE id::text = $1`, [String(a.trip_id)]) : null
      if (a.trip_id && !trip) return 'No trip with that id.'
      const r = await createEvent({ ...a, notes: scrub(a.notes || ''), show_as: 'busy' }, ['Aimelia', 'Travel'], trip ? `Trip: ${trip.title}` : '')
      if (typeof r === 'string') return r
      if (trip) await q(`UPDATE trips SET holds = holds || $2::jsonb, updated_at = now() WHERE id = $1`, [trip.id, json([{ id: r.id, subject: r.subject, start: r.start, end: r.end }])])
      return r
    },
  },
  request_booking: {
    about: 'Draft the booking request in Tom\'s Outlook, never sent, to whoever books his travel: every leg with times, class, hotel, dates, budget and anything to watch. Card and passport numbers are never included. When Tom approves the plan',
    args: '{"trip_id": "the trip", "to": "the booker\'s email address", "subject": "optional", "body": "the full request, signed off Best regards, Tom"}',
    available: microsoftLive,
    run: async (a) => {
      const trip = await one(`SELECT * FROM trips WHERE id::text = $1`, [String(a.trip_id || '')])
      if (!trip) return 'Not drafted: save the trip first, then ask for it to be booked.'
      const problem = recipientProblem(String(a.to || ''))
      if (problem) return problem
      const text = scrub(String(a.body || '').trim())
      if (!text) return 'Not drafted: the request is empty.'
      const subject = String(a.subject || `Please book: ${trip.title}${trip.depart_date ? `, ${trip.depart_date}` : ''}`).slice(0, 255)
      const d = await createDraft(String(a.to), subject, text)
      if (['idea', 'planned'].includes(trip.status)) await q(`UPDATE trips SET status = 'requested', updated_at = now() WHERE id = $1`, [trip.id])
      return { drafted: true, sent: false, to: a.to, subject, link: d.link, trip_status: 'requested' }
    },
  },
}
