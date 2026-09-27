'use client'

/**
 * Ask Aimelia: one conversation with the chat agent. Used by the full page and by the drawer
 * that opens from the Ask Aimelia button on every other page. Replies are plain text, rendered
 * with React, never as HTML.
 */
import { useEffect, useRef, useState } from 'react'
import { chat } from '@/lib/client/todo'

export type Step = { tool: string; args: Record<string, any>; ok: boolean; note: string }
export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; steps: Step[]; created_at: string }
export type ChatSummary = { id: string; title: string; updated_at: string }

const STEP_LABEL: Record<string, string> = {
  briefing: 'Checked what is waiting on you', search_tasks: 'Searched tasks', get_task: 'Read a task', create_task: 'Added a task',
  answer_question: 'Answered an agent question', search_knowledge: 'Searched the knowledge base', recent_emails: 'Read sorted email',
  upcoming_meetings: 'Read the calendar', ws_lookup: 'Looked up',
}

export const STARTERS = [
  'What needs my attention today?',
  'Anything urgent in my inbox?',
  'What is in my diary for the next two days?',
  'Add a task: chase Bentleys for the June payroll sign-off by Friday',
]

function stepText(s: Step) {
  const label = STEP_LABEL[s.tool] || s.tool
  const detail = s.tool === 'ws_lookup' ? ` ${s.args.source}.${s.args.tool}` : s.args.query ? `: "${s.args.query}"` : s.tool === 'create_task' && s.args.title ? `: ${s.args.title}` : ''
  return `${label}${detail}${s.ok ? '' : ` (${s.note || 'failed'})`}`
}

export function Conversation({ chatId, onChat, compact = false }: { chatId: string | null; onChat: (c: ChatSummary) => void; compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const sentHere = useRef<string | null>(null)

  useEffect(() => {
    setErr('')
    if (!chatId) { setMessages([]); return }
    if (sentHere.current === chatId) return // just created by sending from here: the messages are already on screen
    chat<{ messages: ChatMessage[] }>(`/chats/${chatId}`).then((r) => setMessages(r.messages)).catch((e) => setErr(e.message))
  }, [chatId])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages, busy])

  const send = async (message: string) => {
    const m = message.trim()
    if (!m || busy) return
    setBusy(true); setErr(''); setText('')
    const pending: ChatMessage = { id: `pending-${Date.now()}`, role: 'user', content: m, steps: [], created_at: new Date().toISOString() }
    setMessages((xs) => [...xs, pending])
    try {
      const r = await chat<{ chat: ChatSummary; messages: ChatMessage[] }>('/chats', { method: 'POST', body: { message: m, chat_id: chatId } })
      setMessages((xs) => [...xs.filter((x) => x.id !== pending.id), ...r.messages])
      sentHere.current = r.chat.id
      onChat(r.chat)
    } catch (e: any) {
      setErr(`${e.message} Your message is saved; send again to retry.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`chat ${compact ? 'compact' : ''}`}>
      <div className="chat-log" aria-live="polite">
        {messages.length === 0 && !busy && (
          <div className="chat-empty">
            <p>Ask about your tasks, inbox, diary, the knowledge base or client figures, or tell me what to add to the list. I look things up before I answer, and I never send anything.</p>
            <div className="chat-starters">{STARTERS.map((s) => <button key={s} className="btn" onClick={() => send(s)}>{s}</button>)}</div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="who">{m.role === 'user' ? 'You' : 'Aimelia'}</div>
            <div className="bubble">{m.content}</div>
            {m.steps.length > 0 && <ul className="chat-steps">{m.steps.map((s, i) => <li key={i} className={s.ok ? '' : 'err'}>{stepText(s)}</li>)}</ul>}
          </div>
        ))}
        {busy && <div className="chat-msg assistant"><div className="who">Aimelia</div><div className="bubble thinking">Working on it ...</div></div>}
        <div ref={end} />
      </div>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
      <div className="chat-input">
        <textarea className="inp" rows={compact ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message"
          placeholder="Ask Aimelia ... (Enter to send, Shift+Enter for a new line)"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => send(text)}>{busy ? 'Working ...' : 'Send'}</button>
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
