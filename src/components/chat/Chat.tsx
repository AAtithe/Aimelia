'use client'

/**
 * Ask Aimelia: one conversation with the chat agent. Used by the full page and by the drawer
 * that opens from the Ask Aimelia button on every other page. Replies are plain text, rendered
 * with React, never as HTML.
 *
 * Photos, PDFs and documents can go with a message: Attach, drag and drop, or paste. Large photos
 * are shrunk here first (longest side 1600px, JPEG), so a phone photo fits the 3 MB limit and
 * iPhone HEIC photos arrive as JPEG wherever the browser can open them.
 */
import { useEffect, useRef, useState } from 'react'
import { chat } from '@/lib/client/todo'

export type Step = { tool: string; args: Record<string, any>; ok: boolean; note: string; by?: string }
export type ChatFile = { id: string; name: string; kind: 'image' | 'pdf' | 'text'; media_type: string; size: number }
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; steps: Step[]; created_at: string; files?: ChatFile[] }
export type AgentId = 'aimelia' | 'calendar' | 'travel'
export type ChatSummary = { id: string; title: string; updated_at: string; agent?: AgentId }
export const AGENT_LABEL: Record<AgentId, string> = { aimelia: 'Aimelia', calendar: 'Calendar agent', travel: 'Travel agent' }
type Pending = { name: string; data: string; size: number; preview: string | null }

const STEP_LABEL: Record<string, string> = {
  briefing: 'Checked what is waiting on you', search_tasks: 'Searched tasks', get_task: 'Read a task', create_task: 'Added a task',
  answer_question: 'Answered an agent question', search_knowledge: 'Searched the knowledge base', recent_emails: 'Read sorted email',
  upcoming_meetings: 'Read the calendar', ws_lookup: 'Looked up', add_to_knowledge: 'Saved to the knowledge base',
  update_task: 'Updated a task', calculate: 'Worked out the figures', web_search: 'Searched the web', remember: 'Remembered',
  forget: 'Forgot', search_conversations: 'Searched earlier conversations', search_email: 'Searched your mailbox', read_email: 'Read an email',
  draft_email: 'Saved a draft in Outlook (not sent)', meeting_brief: 'Wrote a meeting brief', book_focus_time: 'Booked focus time',
  search_memory: 'Checked what Aimelia knows', save_for_later: 'Kept for later',
  ask_calendar_agent: 'Handed it to the calendar agent', ask_travel_agent: 'Handed it to the travel agent',
  calendar_view: 'Read the calendar', review_calendar: 'Checked the calendar for problems', find_free_time: 'Found free time',
  create_event: 'Added to the calendar', update_event: 'Changed a calendar event', cancel_event: 'Cancelled a calendar event',
  respond_to_invite: 'Answered an invitation', save_trip: 'Saved the trip', list_trips: 'Read the trips',
  hold_travel_time: 'Held travel time in the calendar', request_booking: 'Drafted the booking request in Outlook (not sent)',
}

export const STARTERS: Record<AgentId, string[]> = {
  aimelia: [
    'What needs my attention today?',
    'Anything urgent in my inbox?',
    'What is in my diary for the next two days?',
    'Add a task: chase Bentleys for the June payroll sign-off by Friday',
  ],
  calendar: [
    'Check my diary for the next week and flag anything wrong',
    'Find me two hours this week for the budget review',
    'Which invitations have I not answered?',
    'Block Friday afternoon for month-end',
  ],
  travel: [
    'Plan my trip to Manchester for the Bentleys board meeting',
    'What trips do I have coming up?',
    'Find me a hotel near the client for next Wednesday night',
    'Has the booking confirmation for my next trip come in?',
  ],
}
const EMPTY_TEXT: Record<AgentId, string> = {
  aimelia: 'Ask about your tasks, inbox, diary, the knowledge base or client figures, or tell me what to add to the list. Send photos, PDFs and documents too: a receipt, an HMRC letter, a whiteboard, a set of accounts. I look things up before I answer, and I never send anything.',
  calendar: 'I check your calendar for clashes, missing breaks, too little travel time and unanswered invitations, find time, and add, move or cancel your own events. Meetings with other people I never move: I draft the email proposing the change for you to send.',
  travel: 'Tell me where you need to be and when. I plan it door to door with real times and fares, hold the travel time in your diary, keep the trip, and draft the booking request for you to send. I cannot pay or book anything myself.',
}

const ACCEPT = 'image/*,.png,.jpg,.jpeg,.gif,.webp,.heic,.pdf,.docx,.txt,.md,.csv,.vtt,.srt'
const MAX_FILES = 5
const MAX_TOTAL = 4_200_000 // base64 characters: about 3 MB of files, Vercel's request limit
const SHRINK_OVER = 900_000
const LONG_SIDE = 1600

function stepText(s: Step) {
  const label = `${s.by ? `${s.by}: ` : ''}${STEP_LABEL[s.tool] || s.tool}`
  const detail = s.tool === 'ws_lookup' ? ` ${s.args.source}.${s.args.tool}` : s.args.query ? `: "${s.args.query}"`
    : s.tool === 'calculate' && s.args.sums ? `: ${Object.keys(s.args.sums).slice(0, 4).join(', ')}`
    : (s.tool === 'create_task' || s.tool === 'add_to_knowledge' || s.tool === 'book_focus_time') && s.args.title ? `: ${s.args.title}`
    : s.tool === 'remember' && s.args.fact ? `: ${s.args.fact}` : s.tool === 'draft_email' && s.args.subject ? `: ${s.args.subject}`
    : (s.tool === 'create_event' || s.tool === 'hold_travel_time') && s.args.subject ? `: ${s.args.subject}${s.args.start ? `, ${String(s.args.start).replace('T', ' ')}` : ''}`
    : s.tool === 'save_trip' && s.args.title ? `: ${s.args.title}` : s.tool === 'respond_to_invite' && s.args.response ? ` (${s.args.response})` : ''
  return `${label}${detail}${s.ok ? '' : ` (${s.note || 'failed'})`}`
}

const sizeText = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`)

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Big photos (and every HEIC) redrawn as JPEG with the longest side at most LONG_SIDE. Anything the browser cannot open is sent as it is. */
async function shrink(file: File): Promise<{ blob: Blob; name: string }> {
  const heic = /^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name)
  if (!heic && (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SHRINK_OVER)) return { blob: file, name: file.name }
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, LONG_SIDE / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff' // transparent screenshots get a white page, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    return blob ? { blob, name: file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg' } : { blob: file, name: file.name }
  } catch {
    return { blob: file, name: file.name }
  }
}

function Files({ files }: { files?: ChatFile[] }) {
  if (!files?.length) return null
  return (
    <div className="chat-files">
      {files.map((f) => f.kind === 'image'
        // eslint-disable-next-line @next/next/no-img-element
        ? <a key={f.id} href={`/api/chat/files/${f.id}`} target="_blank" rel="noreferrer"><img className="chat-thumb" src={`/api/chat/files/${f.id}`} alt={f.name} /></a>
        : <a key={f.id} className="chat-file" href={`/api/chat/files/${f.id}`}>{f.name} <span>{f.kind === 'pdf' ? 'PDF' : 'Document'}, {sizeText(f.size)}</span></a>)}
    </div>
  )
}

export function Conversation({ chatId, onChat, compact = false, agent = 'aimelia' }: { chatId: string | null; onChat: (c: ChatSummary) => void; compact?: boolean; agent?: AgentId }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadedAgent, setLoadedAgent] = useState<AgentId | null>(null)
  const who = chatId ? loadedAgent || agent : agent // an open conversation keeps the agent it was started with
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const sentHere = useRef<string | null>(null)

  useEffect(() => {
    setErr('')
    if (!chatId) { setMessages([]); setLoadedAgent(null); return }
    if (sentHere.current === chatId) return // just created by sending from here: the messages are already on screen
    chat<{ chat: ChatSummary; messages: ChatMessage[] }>(`/chats/${chatId}`).then((r) => { setMessages(r.messages); setLoadedAgent(r.chat.agent || 'aimelia') }).catch((e) => setErr(e.message))
  }, [chatId])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages, busy])

  const addFiles = async (list: FileList | File[] | null) => {
    const files = Array.from(list || [])
    if (!files.length) return
    setErr('')
    if (pending.length + files.length > MAX_FILES) return setErr(`Send up to ${MAX_FILES} files at a time.`)
    setReading(true)
    try {
      const added: Pending[] = []
      for (const f of files) {
        const { blob, name } = await shrink(f)
        const isImage = blob.type.startsWith('image/') && !/hei[cf]/.test(blob.type)
        added.push({ name: name || 'pasted.png', data: await toBase64(blob), size: blob.size, preview: isImage ? URL.createObjectURL(blob) : null })
      }
      const total = [...pending, ...added].reduce((n, p) => n + p.data.length, 0)
      if (total > MAX_TOTAL) {
        added.forEach((p) => p.preview && URL.revokeObjectURL(p.preview))
        return setErr('Those files come to more than 3 MB together. Send fewer at once, or a smaller copy.')
      }
      setPending((xs) => [...xs, ...added])
    } finally {
      setReading(false)
    }
  }
  const removeFile = (i: number) => setPending((xs) => { xs[i]?.preview && URL.revokeObjectURL(xs[i].preview!); return xs.filter((_, j) => j !== i) })

  const send = async (message: string) => {
    const m = message.trim()
    if ((!m && !pending.length) || busy || reading) return
    const files = pending
    setBusy(true); setErr(''); setText(''); setPending([])
    const shown: ChatMessage = { id: `pending-${Date.now()}`, role: 'user', content: m, steps: [], created_at: new Date().toISOString(),
      files: files.map((f, i) => ({ id: `p${i}`, name: f.name, kind: f.preview ? 'image' : 'text', media_type: '', size: f.size })) }
    setMessages((xs) => [...xs, shown])
    try {
      const r = await chat<{ chat: ChatSummary; messages: ChatMessage[] }>('/chats', { method: 'POST',
        body: { message: m, chat_id: chatId, agent: who, files: files.map((f) => ({ name: f.name, data: f.data })) } })
      setMessages((xs) => [...xs.filter((x) => x.id !== shown.id), ...r.messages])
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview))
      sentHere.current = r.chat.id
      setLoadedAgent(r.chat.agent || who)
      onChat(r.chat)
    } catch (e: any) {
      // Put it all back, so sending again is one click.
      setMessages((xs) => xs.filter((x) => x.id !== shown.id))
      setText(m); setPending(files)
      setErr(`${e.message} Your message is back in the box; send it again to retry.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`chat ${compact ? 'compact' : ''} ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) } }}>
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="chat-empty">
            <p>{EMPTY_TEXT[who]}</p>
            <div className="chat-starters">{STARTERS[who].map((s) => <button key={s} className="btn" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="who">{m.role === 'user' ? 'You' : AGENT_LABEL[who]}</div>
            {m.id.startsWith('pending-') && m.files?.length ? <div className="chat-files">{m.files.map((f) => <span key={f.id} className="chat-file">{f.name}</span>)}</div> : <Files files={m.files} />}
            {m.content && <div className="bubble">{m.content}</div>}
            {m.steps.length > 0 && <ul className="chat-steps">{m.steps.map((s, i) => <li key={i} className={s.ok ? '' : 'err'}>{stepText(s)}</li>)}</ul>}
          </div>
        ))}
        {busy && <div className="chat-msg assistant"><div className="who">{AGENT_LABEL[who]}</div><div className="bubble thinking">{pending.length || messages.at(-1)?.files?.length ? 'Reading it ...' : 'Working on it ...'}</div></div>}
        <div ref={end} />
      </div>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
      {(pending.length > 0 || reading) && (
        <div className="chat-pending">
          {pending.map((p, i) => (
            <div key={i} className="chat-chip">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.preview && <img src={p.preview} alt="" />}
              <span className="nm">{p.name}</span><span className="sz">{sizeText(p.size)}</span>
              <button className="linkbtn" onClick={() => removeFile(i)} aria-label={`Remove ${p.name}`}>Remove</button>
            </div>
          ))}
          {reading && <span className="cap">Preparing ...</span>}
        </div>
      )}
      <div className="chat-input">
        <input ref={picker} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <button className="btn" onClick={() => picker.current?.click()} disabled={busy || pending.length >= MAX_FILES} title="Photos, PDFs, Word, text, CSV or transcripts, up to 3 MB">Attach</button>
        <textarea className="inp" rows={compact ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message"
          placeholder={dragging ? 'Drop to attach' : `${who === 'aimelia' ? 'Ask Aimelia' : `Ask the ${AGENT_LABEL[who].toLowerCase()}`}, or drop in a photo or file ... (Enter to send, Shift+Enter for a new line)`}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files) } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} />
        <button className="btn primary" disabled={busy || reading || (!text.trim() && !pending.length)} onClick={() => send(text)}>{busy ? 'Working ...' : 'Send'}</button>
      </div>
    </div>
  )
}

/** The Ask Aimelia button and drawer, on every page except the full chat page. */
export function ChatLauncher() {
  const [open, setOpen] = useState(false)
  const [chatId, setChatId] = useState<string | null>(null)
  return (
    <>
      <button className="btn primary chatfab" onClick={() => setOpen(true)} aria-haspopup="dialog">Ask Aimelia</button>
      {open && (
        <>
          <div className="drawer-bg open" onClick={() => setOpen(false)} />
          <aside className="drawer wide open" role="dialog" aria-label="Ask Aimelia">
            <div className="dh">
              <div className="o">Chat agent</div>
              <div className="t">Ask Aimelia</div>
              <button className="dclose" onClick={() => setOpen(false)} aria-label="Close">&times;</button>
            </div>
            <div className="db">
              <div className="toolbar" style={{ marginTop: 0 }}>
                <button className="linkbtn" onClick={() => setChatId(null)} disabled={!chatId}>New conversation</button>
                <a className="linkbtn" href={chatId ? `/chat?c=${chatId}` : '/chat'}>Open full page</a>
              </div>
              <Conversation chatId={chatId} onChat={(c) => setChatId(c.id)} compact />
            </div>
          </aside>
        </>
      )}
    </>
  )
}
