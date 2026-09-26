'use client'

import { useState } from 'react'
import { api, Task, PRIORITY_LABEL, dueState, fmtDate } from '@/lib/client/todo'
import { StatusPill, VoiceButton } from './Cards'

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
                  {t.due_date ? fmtDate(t.due_date) : <span className="cap">None set</span>}
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

export function BrainDump({ onAdded }: { onAdded: () => void }) {
  const [mode, setMode] = useState<'dump' | 'one'>('dump')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState(2)
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'dump') {
        const made = await api<Task[]>('/capture', { method: 'POST', body: { text } })
        setMsg({ ok: true, text: `Split into ${made.length} task${made.length === 1 ? '' : 's'}: ${made.map((t) => t.title).join('; ')}. The team is on them.` })
        setText('')
      } else {
        await api('/tasks', { method: 'POST', body: { title, notes: text, priority, due_date: due || null } })
        setMsg({ ok: true, text: 'Added. The team is on it.' })
        setTitle(''); setText(''); setDue(''); setPriority(2)
      }
      onAdded()
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const ready = mode === 'dump' ? !!text.trim() : !!title.trim()

  return (
    <div className="card">
      <h2>Give the team your list</h2>
      <div className="body">
        <div className="main-tabs" style={{ marginBottom: 10 }}>
          <button className={`main-tab-btn ${mode === 'dump' ? 'active' : ''}`} onClick={() => setMode('dump')}>Brain dump</button>
          <button className={`main-tab-btn ${mode === 'one' ? 'active' : ''}`} onClick={() => setMode('one')}>One task</button>
        </div>
        {mode === 'dump' ? (
          <>
            <p className="cap">Paste or dictate everything on your mind, as messy as it comes. It is split into separate tasks, and Triage decides which ones you do, delegate, defer or drop.</p>
            <textarea className="inp" rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="Brain dump"
              placeholder={'Chase Corrigans for Q3 tronc sign-off before Friday\nBentleys want to talk about labour %, book a call\nReview Sam\'s pay rise case\nPrice for the new Soho group, 6 sites'} />
          </>
        ) : (
          <>
            <label className="fld"><span>Task</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chase Corrigans for Q3 tronc sign-off"
                onKeyDown={(e) => e.key === 'Enter' && title.trim() && !busy && submit()} />
            </label>
            <label className="fld"><span>Brief: context, people, numbers, what good looks like. More detail means fewer questions.</span>
              <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
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
          </>
        )}
        <div className="toolbar">
          <button className="btn primary" disabled={busy || !ready} onClick={submit}>
            {busy ? 'Sending ...' : mode === 'dump' ? 'Split and hand to the team' : 'Hand to the team'}
          </button>
          <VoiceButton onText={(said) => setText((prev) => (prev ? `${prev.replace(/\s+$/, '')}\n${said}` : said))} />
        </div>
        <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
      </div>
    </div>
  )
}
