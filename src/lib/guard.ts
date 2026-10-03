/**
 * Guards for phone and WhatsApp numbers, and limits on what Ask Aimelia may change in one message.
 *
 * Aimelia has no way to message, text or call anyone: there is no WhatsApp, SMS or send-mail tool, and email is only ever
 * a draft in Outlook. These guards are enforced in code, not left to the model's judgement:
 * - a phone number never goes into a web search (it would leave the firm's systems for a search engine)
 * - email drafts go to email addresses only, never a number, and to at most MAX_RECIPIENTS people
 * - Aimelia's own learning never keeps a phone number; only Tom's explicit "remember" does
 * - each message may make at most TURN_LIMITS changes of each kind, so a pasted list of numbers or names cannot fan out
 *   into dozens of drafts or tasks
 */

/**
 * Phone numbers as written in UK and international use, and WhatsApp links. Tuned so money, dates, sort codes (6 digits),
 * VAT numbers (GB + 9) and company numbers (8) do not match: a number must start with +, 00 or 0 and have enough digits.
 */
const CANDIDATE = /(?:https?:\/\/)?(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)\+?\d{7,15}|(?<![\w+])(?:\+|00)\d[\d ().-]{6,20}\d(?![\w])|(?<![\w.,£$€(])\(?0\d[\d ().-]{7,14}\d(?![\w])/gi

const digitsOf = (s: string) => s.replace(/\D/g, '')

function isPhone(match: string) {
  if (/wa\.me|whatsapp/i.test(match)) return true
  const d = digitsOf(match)
  if (match.startsWith('+')) return d.length >= 8 && d.length <= 15
  if (match.startsWith('00')) return d.length >= 10 && d.length <= 17
  if (!/^\(?0/.test(match)) return false
  return d.length === 10 || d.length === 11 // UK: 0 then 9 or 10 digits
}

/** The phone number at the start of a match, dropping trailing groups the pattern took greedily ("07700 900123 12"). */
function phoneIn(match: string): string | null {
  let m = match.trim()
  while (m) {
    if (isPhone(m)) return m
    const cut = m.search(/[ ().-][^ ().-]*$/)
    if (cut <= 0) return null
    m = m.slice(0, cut).replace(/[ ().-]+$/, '')
  }
  return null
}

/** The phone and WhatsApp numbers in a text, as written. */
export function findPhones(text: unknown): string[] {
  return (String(text ?? '').match(CANDIDATE) || []).map(phoneIn).filter((m): m is string => !!m)
}

export const hasPhone = (text: unknown) => findPhones(text).length > 0

export const PHONE_REMOVED = '[number removed]'

/** The text with every phone and WhatsApp number replaced. */
export function redactPhones(text: string) {
  return String(text ?? '').replace(CANDIDATE, (m) => { const p = phoneIn(m); return p ? m.replace(p, PHONE_REMOVED) : m })
}

const EMAIL = /^[^\s@<>;,]+@[^\s@<>;,]+\.[a-z]{2,}$/i
export const MAX_RECIPIENTS = 10

/** Why a new draft's recipients are refused, or null when they are all email addresses. */
export function recipientProblem(to: string): string | null {
  const list = String(to || '').split(/[;,]/).map((x) => x.trim()).filter(Boolean)
  if (!list.length) return 'Not drafted: a new email needs to and subject.'
  if (list.some((x) => hasPhone(x) || /^\+?[\d ().-]{7,}$/.test(x))) {
    return 'Not drafted: that is a phone number. Aimelia cannot message, text or WhatsApp anyone. It only drafts email in Outlook, to email addresses.'
  }
  const bad = list.filter((x) => !EMAIL.test(x))
  if (bad.length) return `Not drafted: ${bad.slice(0, 3).join(', ')} is not an email address.`
  if (list.length > MAX_RECIPIENTS) return `Not drafted: ${list.length} recipients is more than ${MAX_RECIPIENTS}. Ask Tom to confirm who it goes to.`
  return null
}

/** The most of each change Ask Aimelia may make in answer to one message. Reads are not limited. */
export const TURN_LIMITS: Record<string, number> = {
  draft_email: 3, create_task: 10, update_task: 10, answer_question: 10, record_stage_answer: 10, add_to_knowledge: 5,
  remember: 5, forget: 5, book_focus_time: 2, meeting_brief: 3,
}

/** Counts changes within one message; a call past its limit is refused before it runs. */
export function turnLimiter(limits: Record<string, number> = TURN_LIMITS) {
  const used: Record<string, number> = {}
  return (tool: string): string | null => {
    const limit = limits[tool]
    if (limit === undefined) return null
    if ((used[tool] || 0) >= limit) {
      return `Not done: Aimelia makes at most ${limit} ${tool} calls for one message. Tell Tom what is left and ask him to confirm the rest in his next message.`
    }
    used[tool] = (used[tool] || 0) + 1
    return null
  }
}
