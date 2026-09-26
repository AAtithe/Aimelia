/**
 * Meeting briefs and "prep me like a star". One engine, two styles:
 *  - brief: key points, background, next steps; under 300 words
 *  - prep: the six-section brief (Snapshot, Recent comms, Open actions, Talking points, Risks, Next steps); under 400 words
 * Briefs are saved in Aimelia. The original overwrote the calendar event's description on every
 * run and fell back to emailing a hard-coded address; neither happens now.
 */
import { graph } from '../microsoft'
import { complete } from '../llm'
import { env } from '../env'
import { iso, json, one, q, type Row } from '../db'
import { buildMessages, withInstruction } from './context'
import { index } from './knowledge'
import { addressOf, type GraphMessage } from './mail'
import { wordCount } from './drafting'

export type Style = 'brief' | 'prep'

export const PREP_INSTRUCTION = `You are preparing a comprehensive meeting brief for Tom Stanley at Williams, Stanley & Co.

Create a polished, professional brief with these sections:

1. SNAPSHOT
   - Meeting time and duration
   - Key attendees and their roles
   - Location/format

2. RECENT COMMS
   - Key communications leading to this meeting
   - Important context and background

3. OPEN ACTIONS
   - Outstanding items from previous meetings
   - Follow-ups that need addressing

4. TALKING POINTS (5 key points)
   - Main agenda items
   - Critical discussion topics
   - Decisions that need to be made

5. RISKS
   - Potential challenges or concerns
   - Sensitive topics to handle carefully

6. NEXT STEPS
   - Clear action items for after the meeting
   - Follow-up requirements

Requirements:
- Maximum 400 words total
- Use UK English spelling
- Be decisive and professional
- Focus on hospitality industry context
- Make it actionable and insightful
- Use bullet points for clarity
- No emojis and no em dashes

Format as a clean, professional brief ready for Tom to review. Plain text only: section titles on their own line, bullets starting "- ".`

export const BRIEF_INSTRUCTION = `Create a meeting brief for Tom with:
1. Meeting snapshot (time, attendees, purpose)
2. Key talking points based on recent communications
3. Background context from emails
4. Suggested next steps
5. Any action items or follow-ups needed

Under 300 words. UK English. No emojis and no em dashes. Plain text only: section titles on their own line, bullets starting "- ".`

export const PREP_GUIDELINES = {
  purpose: 'Prep Tom Stanley like a star for every meeting', format: 'Comprehensive brief with 6 key sections', max_words: 400,
  tone: 'Professional, decisive, hospitality-savvy',
  brief_sections: { '1_snapshot': 'Meeting time, attendees, location', '2_recent_comms': 'Key communications and context',
    '3_open_actions': 'Outstanding items and follow-ups', '4_talking_points': 'Five main agenda items', '5_risks': 'Challenges and sensitive topics',
    '6_next_steps': 'Actions after the meeting' },
  saved_to: 'Aimelia only; your calendar events are never changed',
}

export type CalEvent = { id: string; subject?: string; start?: { dateTime: string }; end?: { dateTime: string }; location?: { displayName?: string }
  attendees?: { emailAddress?: { address?: string; name?: string } }[]; organizer?: { emailAddress?: { address?: string; name?: string } }
  isOnlineMeeting?: boolean; onlineMeeting?: { joinUrl?: string }; isAllDay?: boolean; bodyPreview?: string; showAs?: string; isCancelled?: boolean }

const EVENT_FIELDS = 'id,subject,start,end,location,attendees,organizer,isOnlineMeeting,onlineMeeting,isAllDay,bodyPreview,showAs,isCancelled'

/** Events in the next N hours, in London time (the original returned UTC shown as local). */
export async function upcomingEvents(hours = 24, top = 25): Promise<CalEvent[]> {
  const now = new Date()
  const res = await graph<{ value: CalEvent[] }>('GET', '/me/calendarView', {
    headers: { Prefer: `outlook.timezone="${env.timezone()}"` },
    query: { startDateTime: now.toISOString(), endDateTime: new Date(now.getTime() + hours * 3600000).toISOString(), $orderby: 'start/dateTime', $top: top, $select: EVENT_FIELDS },
  })
  return (res.value || []).filter((e) => !e.isCancelled)
}

export const attendeeEmails = (e: CalEvent) => (e.attendees || []).map((a) => a.emailAddress?.address).filter(Boolean) as string[]

/** Latest emails from the attendees. Filtered per sender without $orderby (Graph rejects that pairing), then sorted here. */
export async function recentComms(emails: string[], limit = 5): Promise<GraphMessage[]> {
  const out: GraphMessage[] = []
  for (const address of emails.slice(0, 8)) {
    try {
      const r = await graph<{ value: GraphMessage[] }>('GET', '/me/messages', {
        query: { $filter: `from/emailAddress/address eq '${address.replace(/'/g, "''")}'`, $top: 5, $select: 'subject,from,receivedDateTime,bodyPreview' } })
      out.push(...(r.value || []))
    } catch {
      /* one attendee failing should not stop the brief */
    }
  }
  return out.sort((a, b) => String(b.receivedDateTime).localeCompare(String(a.receivedDateTime))).slice(0, limit)
}

function meetingMeta(e: CalEvent, comms: GraphMessage[]) {
  return {
    meeting_subject: e.subject || 'Meeting', title: e.subject || 'Meeting', start_time: e.start?.dateTime, end_time: e.end?.dateTime,
    location: e.location?.displayName || (e.isOnlineMeeting ? 'Online' : ''), organizer: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || '',
    attendees: (e.attendees || []).map((a) => (a.emailAddress?.name ? `${a.emailAddress.name} (${a.emailAddress.address})` : a.emailAddress?.address)),
    description: (e.bodyPreview || '').slice(0, 300),
    recent_comms: comms.map((m) => `- ${m.from?.emailAddress?.name || addressOf(m)}: ${m.subject} (${String(m.receivedDateTime).slice(0, 10)}) - ${(m.bodyPreview || '').slice(0, 100)}...`).join('\n'),
  }
}

export async function writeBrief(e: CalEvent, style: Style, comms: GraphMessage[]) {
  const meta = meetingMeta(e, comms)
  const built = await buildMessages('brief', meta, `${meta.meeting_subject} meeting brief ${attendeeEmails(e).join(', ')}`)
  const { system, messages } = withInstruction(built, style === 'prep' ? PREP_INSTRUCTION : BRIEF_INSTRUCTION)
  const text = (await complete({ provider: 'auto', role: 'brief', system, messages, maxTokens: 900, temperature: 0.3, payload: meta })).trim()
  return `${text}\n\n---\nPrepared by Aimelia`
}

async function saveMeeting(e: CalEvent, brief: string | null, style: Style | null, commsCount: number) {
  await q(`INSERT INTO meetings (graph_event_id, subject, start_at, end_at, attendees, organizer, location, is_online, join_url, brief, brief_style, brief_word_count, recent_comms_count, brief_generated_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $10::text IS NULL THEN NULL ELSE now() END)
           ON CONFLICT (graph_event_id) DO UPDATE SET subject = EXCLUDED.subject, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, attendees = EXCLUDED.attendees,
             organizer = EXCLUDED.organizer, location = EXCLUDED.location, is_online = EXCLUDED.is_online, join_url = EXCLUDED.join_url,
             brief = COALESCE(EXCLUDED.brief, meetings.brief), brief_style = COALESCE(EXCLUDED.brief_style, meetings.brief_style),
             brief_word_count = COALESCE(EXCLUDED.brief_word_count, meetings.brief_word_count),
             recent_comms_count = CASE WHEN EXCLUDED.brief IS NULL THEN meetings.recent_comms_count ELSE EXCLUDED.recent_comms_count END,
             brief_generated_at = COALESCE(EXCLUDED.brief_generated_at, meetings.brief_generated_at)`,
    [e.id, e.subject || '', londonToIso(e.start?.dateTime), londonToIso(e.end?.dateTime), json(attendeeEmails(e)), e.organizer?.emailAddress?.address || '',
      e.location?.displayName || '', !!e.isOnlineMeeting, e.onlineMeeting?.joinUrl || null, brief, style, brief ? wordCount(brief) : null, commsCount])
}

/** Graph returns London wall-clock times (we asked for them); store as a proper instant. */
export function londonToIso(wall?: string): string | null {
  if (!wall) return null
  const base = wall.slice(0, 19)
  const asUtc = new Date(`${base}Z`)
  // Work out London's offset at that moment.
  const london = new Date(asUtc.toLocaleString('en-US', { timeZone: env.timezone() }))
  const utc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }))
  return new Date(asUtc.getTime() - (london.getTime() - utc.getTime())).toISOString()
}

export async function briefForEvent(eventId: string, style: Style) {
  const e = await graph<CalEvent>('GET', `/me/events/${encodeURIComponent(eventId)}`, { headers: { Prefer: `outlook.timezone="${env.timezone()}"` }, query: { $select: EVENT_FIELDS } })
  const comms = await recentComms(attendeeEmails(e))
  const brief = await writeBrief(e, style, comms)
  await saveMeeting(e, brief, style, comms.length)
  await index('meeting', e.id, `Meeting: ${e.subject || 'Meeting'}`, `Attendees: ${attendeeEmails(e).join(', ')}\n\n${brief}`)
  return meetingOut((await one(`SELECT * FROM meetings WHERE graph_event_id = $1`, [e.id]))!)
}

/** Prepare every meeting in the next 24 hours that has no brief yet (or all, when forced). */
export async function prepareUpcoming(style: Style, force = false) {
  const events = (await upcomingEvents(24)).filter((e) => !e.isAllDay)
  const prepared: unknown[] = []
  const errors: { meeting: string; error: string }[] = []
  for (const e of events) {
    const existing = await one(`SELECT brief, brief_style FROM meetings WHERE graph_event_id = $1`, [e.id])
    if (!force && existing?.brief && existing.brief_style === style) { await saveMeeting(e, null, null, 0); continue }
    try {
      prepared.push(await briefForEvent(e.id, style))
    } catch (err) {
      errors.push({ meeting: e.subject || e.id, error: (err as Error).message })
    }
  }
  return { success: errors.length === 0, total_meetings: events.length, meetings_prepared: prepared.length, prepared_meetings: prepared, errors,
    message: events.length ? `Prepared ${prepared.length} of ${events.length} meetings in the next 24 hours.` : 'No meetings in the next 24 hours.' }
}

export function meetingOut(m: Row) {
  return { event_id: m.graph_event_id, subject: m.subject, start_time: iso(m.start_at), end_time: iso(m.end_at), attendees: m.attendees || [],
    organizer: m.organizer, location: m.location, is_online: m.is_online, meeting_url: m.join_url, brief: m.brief, style: m.brief_style,
    word_count: m.brief_word_count, recent_comms_count: m.recent_comms_count, generated_at: iso(m.brief_generated_at) }
}

/** A test brief from a made-up meeting, no calendar needed. */
export async function testBrief(input: { subject: string; start_time?: string; attendees?: string[]; location?: string }, style: Style) {
  const e: CalEvent = { id: 'test-event', subject: input.subject, start: { dateTime: input.start_time || new Date().toISOString() },
    end: { dateTime: input.start_time || new Date().toISOString() }, location: { displayName: input.location || '' },
    attendees: (input.attendees || []).map((address) => ({ emailAddress: { address } })), organizer: { emailAddress: { name: 'Tom Stanley' } } }
  const brief = await writeBrief(e, style, [])
  return { success: true, brief_content: brief, word_count: wordCount(brief), meets_requirements: wordCount(brief) <= (style === 'prep' ? 420 : 320), meeting_subject: input.subject }
}
