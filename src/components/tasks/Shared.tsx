'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { api, Task, PRIORITY_LABEL, dueState, fmtDate } from '@/lib/client/todo'
import { StatusPill, VoiceButton } from './Cards'
import { attachToTask } from './Documents'

export function TaskTable({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  return (
    <div className="tblwrap">
      <table>
        <thead>
          <tr><th>Task</th><th className="nowrap">Where it is</th><th className="nowrap hide-sm">Priority</th><th className="nowrap">Due</th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const due = dueState(t.due_date, t.status)
            const waiting = [t.open_questions && `${t.open_questions} question${t.open_questions === 1 ? '' : 's'} for you`,
              t.ready_actions && `${t.ready_actions} ready to approve`,
              t.status === 'scheduled' && t.scheduled_for && `parked until ${fmtDate(t.scheduled_for)}`,
              t.kind === 'follow_up' && `checking ${t.follow_up_owner || 'the owner'} delivered`,
              t.kind === 'routine' && 'from a routine'].filter(Boolean).join(', ')
            return (
              <tr key={t.id} className="click" onClick={() => onOpen(t.id)} tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(t.id)}>
                <td>
                  <div className="t">{t.title}</div>
                  <div className="d">{waiting || t.summary || t.notes || 'No brief yet'}</div>
                </td>
                <td className="nowrap"><StatusPill status={t.status} /></td>
                <td className="nowrap hide-sm">{PRIORITY_LABEL[t.priority]}</td>
                <td className="nowrap">
                  {t.status === 'done' ? <span className="cap">Completed {t.closed_at ? fmtDate(t.closed_at) : ''}</span> : t.due_date ? fmtDate(t.due_date) : <span className="cap">None set</span>}
                  {due && <div><span className={`pill ${due.pill}`}>{due.label}</span></div>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The type bar pinned to the bottom of the page. Type or dictate and press Enter: every line
 * becomes a task and Triage takes it from there. "More" opens the full panel above the bar,
 * for a single task with a brief, priority and due date. Esc closes the panel.
 */
export function CaptureBar({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'dump' | 'one'>('dump')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(2)
  const [due, setDue] = useState('')
  const [docs, setDocs] = useState<File[]>([])
  const [docsKey, setDocsKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Grow the box with what is typed, up to about six lines, then scroll.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [text, open, mode])

  useEffect(() => {
    if (!msg?.ok) return
    const t = setTimeout(() => setMsg(null), 7000)
    return () => clearTimeout(t)
  }, [msg])

  const one = open && mode === 'one'
  const ready = one ? !!title.trim() : !!text.trim()

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setMsg(null)
    try {
      if (one) {
        // With documents, the task waits for them to be read before the team starts.
        const t = await api<Task>('/tasks', { method: 'POST', body: { title, notes: text, priority, due_date: due || null, run_now: !docs.length } })
        if (docs.length) {
          try { await attachToTask(t.id, docs) } catch (e: any) { setMsg({ ok: false, text: `The task was added, but the documents were not: ${e.message} Attach them from the task.` }); onAdded(); return }
        }
        setMsg({ ok: true, text: docs.length ? `Added with ${docs.length} document${docs.length === 1 ? '' : 's'}. Claude reads and assesses them, then the team works them through.` : 'Added. The team is on it.' })
        setTitle(''); setText(''); setDue(''); setPriority(2); setDocs([]); setDocsKey((k) => k + 1)
      } else {
        const made = await api<Task[]>('/capture', { method: 'POST', body: { text } })
        setMsg({ ok: true, text: made.length === 1 ? `Added "${made[0].title}". The team is on it.`
          : `Split into ${made.length} tasks: ${made.map((t) => t.title).join('; ')}. The team is on them.` })
        setText('')
      }
      onAdded()
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'Enter' && !e.shiftKey && !one) { e.preventDefault(); submit() }
  }

  return (
    <>
      <div className="capbar-space" aria-hidden />
      <div className={`capbar ${open ? 'open' : ''}`} role="region" aria-label="Give the team your list" onKeyDown={keys}>
        {msg && (
          <div className={`capbar-msg ${msg.ok ? 'ok' : 'err'}`} role="status">
            <span>{msg.text}</span>
            <button type="button" className="capbar-x" onClick={() => setMsg(null)} aria-label="Dismiss">x</button>
          </div>
        )}
        {open && (
          <div className="capbar-panel">
            <div className="capbar-head">
              <div className="main-tabs">
                <button className={`main-tab-btn ${mode === 'dump' ? 'active' : ''}`} onClick={() => setMode('dump')}>Brain dump</button>
                <button className={`main-tab-btn ${mode === 'one' ? 'active' : ''}`} onClick={() => setMode('one')}>One task</button>
              </div>
              <button type="button" className="capbar-x" onClick={() => setOpen(false)} aria-label="Close the panel">x</button>
            </div>
            {mode === 'dump' ? (
              <p className="cap">Everything on your mind, as messy as it comes, one thing per line. It is split into separate tasks, and Triage decides which ones you do, delegate, defer or drop.
                For Microsoft To Do, Word documents, meeting notes or Fireflies, use <Link href="/import">Import tasks</Link>.</p>
            ) : (
              <>
                <label className="fld"><span>Task</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chase Corrigans for Q3 tronc sign-off" autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} />
                </label>
                <div className="row2">
                  <label className="fld"><span>Priority</span>
                    <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                      <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
                    </select>
                  </label>
                  <label className="fld"><span>Due</span>
                    <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                  </label>
                </div>
                <label className="fld"><span>Documents to read and assess (optional): policies, procedures, letters, photos of paperwork</span>
                  <input key={docsKey} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.vtt,.srt,.png,.jpg,.jpeg,.gif,.webp"
                    onChange={(e) => setDocs(Array.from(e.target.files || []))} />
                </label>
              </>
            )}
          </div>
        )}
        <div className="capbar-row">
          <textarea ref={box} rows={1} title="Enter sends. Shift+Enter starts a new line, and each line becomes its own task." value={text} onChange={(e) => setText(e.target.value)}
            aria-label={one ? 'Brief' : 'Give the team your list'}
            placeholder={one ? 'Brief: context, people, numbers, what good looks like' : 'Give the team your list ...'} />
          <VoiceButton onText={(said) => setText((prev) => (prev ? `${prev.replace(/\s+$/, '')}\n${said}` : said))} />
          <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Less' : 'More'}</button>
          <button type="button" className="btn primary" disabled={busy || !ready} onClick={submit}>{busy ? 'Sending ...' : 'Send'}</button>
        </div>
      </div>
    </>
  )
}
