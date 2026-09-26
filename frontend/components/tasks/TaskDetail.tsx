'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, Task, AgentEvent, PRIORITY_LABEL, dueState, fmtDate, fmtDateTime } from '@/lib/todoApi'
import { ActionItem, QuestionItem, StatusPill } from './Cards'

export function TaskDetail({ taskId, onClose, onChanged }: { taskId: string; onClose: () => void; onChanged: () => void }) {
  const [task, setTask] = useState<Task | null>(null)
  const [notes, setNotes] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [deferTo, setDeferTo] = useState('')

  const load = useCallback(async () => {
    try {
      const t = await api<Task>(`/tasks/${taskId}`)
      setTask(t)
      setNotes(t.notes || '')
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    }
  }, [taskId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!task || !['queued', 'processing'].includes(task.status)) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [task, load])

  const refresh = () => { load(); onChanged() }

  // ok is the success message; pass null when fn sets its own.
  const act = async (fn: () => Promise<any>, ok: string | null) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      if (ok) setMsg({ ok: true, text: ok })
      refresh()
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const open = task?.questions?.filter((q) => q.status === 'open') || []
  const answered = task?.questions?.filter((q) => q.status !== 'open') || []
  const live = task?.actions?.filter((a) => a.status === 'proposed') || []
  const history = task?.actions?.filter((a) => a.status !== 'proposed') || []
  const due = task ? dueState(task.due_date, task.status) : null

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Task">
        <div className="dh">
          <button className="dclose" onClick={onClose} aria-label="Close">&times;</button>
          <div className="o">
            {task ? `${PRIORITY_LABEL[task.priority]} priority${task.due_date ? `, due ${fmtDate(task.due_date)}` : ''}` : 'Reading ...'}
          </div>
          <div className="t">{task?.title || ''}</div>
        </div>
        {task && (
          <div className="db">
            <div className="o" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <StatusPill status={task.status} />
              {due && <span className={`pill ${due.pill}`}>{due.label}</span>}
            </div>
            {task.summary && <p className="cap" style={{ marginTop: 8 }}>{task.summary}</p>}
            {task.review_flag && <div className="note bad" style={{ marginTop: 10 }}>{task.review_flag}</div>}
            {task.kind === 'follow_up' && <div className="note info" style={{ marginTop: 10 }}><b>Follow-up.</b> Checks that {task.follow_up_owner || 'the owner'} delivered delegated work.</div>}
            {task.kind === 'routine' && <div className="note info" style={{ marginTop: 10 }}><b>Routine.</b> Created by a routine; change it in the Routines tab.</div>}
            {task.status === 'scheduled' && task.scheduled_for && <div className="note info" style={{ marginTop: 10 }}><b>Parked until {fmtDate(task.scheduled_for)}.</b> It comes back to the team on that day.</div>}
            {task.stale_nudged_at && task.status !== 'done' && <div className="note warn" style={{ marginTop: 10 }}>This sat untouched, so it went back through Triage with an instruction to delegate or drop it.</div>}
            {task.calendar_event && (
              <div className="note info" style={{ marginTop: 10 }}>
                <b>Focus time booked</b> {fmtDateTime(task.calendar_event.start)} to {task.calendar_event.end.slice(11, 16)}.
                {task.calendar_event.link && <> <a href={task.calendar_event.link} target="_blank" rel="noreferrer">Open in Outlook</a></>}
              </div>
            )}

            <div className="toolbar">
              <button className="btn" disabled={busy || task.status === 'processing'}
                onClick={() => act(() => api(`/tasks/${task.id}/run`, { method: 'POST' }), 'Queued. The team will start on it now.')}>Run the team again</button>
              {task.status !== 'done' && (
                <button className="btn" disabled={busy}
                  onClick={() => act(() => api(`/tasks/${task.id}/book`, { method: 'POST', body: {} }).then((r) =>
                    setMsg({ ok: true, text: `Booked ${fmtDateTime(r.event.start)} to ${r.event.end.slice(11, 16)} in your calendar.` })), null)}>
                  Book focus time
                </button>
              )}
              {task.status !== 'done' && (
                <button className="btn" disabled={busy}
                  onClick={() => act(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: 'done' } }), 'Task closed.')}>Close the task</button>
              )}
              <span className="spacer" />
              <button className="btn danger" disabled={busy} onClick={() => {
                if (confirm('Delete this task and everything the agents produced for it?'))
                  act(() => api(`/tasks/${task.id}`, { method: 'DELETE' }).then(onClose), 'Deleted.')
              }}>Delete</button>
            </div>
            <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>

            {task.status !== 'done' && task.status !== 'processing' && (
              <div className="toolbar">
                <label className="fld" style={{ margin: 0 }}><span>Park it until</span>
                  <input type="date" value={deferTo} onChange={(e) => setDeferTo(e.target.value)} />
                </label>
                <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={busy || !deferTo}
                  onClick={() => act(() => api(`/tasks/${task.id}/defer`, { method: 'POST', body: { until: deferTo } }), `Parked until ${fmtDate(deferTo)}.`)}>Defer</button>
              </div>
            )}

            <h3>Brief for the team</h3>
            <textarea className="inp" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, people involved, numbers, what good looks like" aria-label="Brief for the team" />
            {notes !== (task.notes || '') && (
              <div className="toolbar">
                <button className="btn primary" disabled={busy} onClick={() => act(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: { notes } }), 'Brief saved.')}>Save brief</button>
                <button className="btn" onClick={() => setNotes(task.notes || '')}>Cancel</button>
              </div>
            )}

            {open.length > 0 && (<>
              <h3>Questions for you</h3>
              {open.map((q) => <QuestionItem key={q.id} q={q} onDone={refresh} showTask={false} />)}
            </>)}

            {live.length > 0 && (<>
              <h3>Ready for your approval</h3>
              {live.map((a) => <ActionItem key={a.id} a={a} onDone={refresh} showTask={false} />)}
            </>)}

            {task.status !== 'done' && (<>
              <h3>Tell the team what to change</h3>
              <textarea className="inp" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)}
                placeholder="Make the email firmer and mention the 30-day notice period" aria-label="Feedback for the team" />
              <div className="toolbar">
                <button className="btn primary" disabled={busy || !feedback.trim()} onClick={() => act(() =>
                  api(`/tasks/${task.id}/feedback`, { method: 'POST', body: { text: feedback } }).then(() => setFeedback('')), 'Sent. The team will rework it.')}>
                  Send and rework
                </button>
              </div>
            </>)}

            {answered.length > 0 && (<>
              <h3>Answered</h3>
              <ul className="log">
                {answered.map((q) => (
                  <li key={q.id}><div>{q.question}</div><div className="cap" style={{ margin: 0 }}>{q.status === 'dismissed' ? 'Skipped: the team used its judgement' : q.answer}</div></li>
                ))}
              </ul>
            </>)}

            {history.length > 0 && (<>
              <h3>Earlier actions</h3>
              {history.map((a) => <ActionItem key={a.id} a={a} onDone={refresh} showTask={false} />)}
            </>)}

            <h3>How the team worked</h3>
            {task.events?.length ? (
              <ul className="log">{task.events.map((e) => <EventRow key={e.id} e={e} />)}</ul>
            ) : <p className="cap">Nothing yet. The team has not picked this up.</p>}
          </div>
        )}
      </aside>
    </>
  )
}

function EventRow({ e }: { e: AgentEvent }) {
  const c = e.content || {}
  let text = ''
  if (e.kind === 'worker') text = `${c.summary || 'Worked on the draft'}${c.actions ? ` (${c.actions.length} action${c.actions.length === 1 ? '' : 's'})` : ''}`
  else if (e.kind === 'review') text = `${c.approved ? 'Approved' : 'Sent back'} at ${c.score}/10. ${c.feedback || ''}`
  else if (e.kind === 'question') text = `Asked you: ${(c.questions || []).map((q: any) => q.question).join(' | ')}`
  else if (e.kind === 'answer') text = `You answered "${c.question}": ${c.answer}`
  else if (e.kind === 'feedback') text = c.text
  else if (e.kind === 'error') text = c.error
  else if (e.kind === 'lookup') text = c.error ? `Could not look anything up: ${c.error}` : `Looked up ${(c.calls || []).map((x: any) => `${x.call}${x.error ? ' (failed)' : ''}${x.why ? `: ${x.why}` : ''}`).join('; ')}`
  else if (e.kind === 'status') text = `${c.status === 'queued' ? 'Queued' : `Now ${c.status}`}${c.reason ? `: ${c.reason}` : ''}${c.action ? `, ${c.action}` : ''}`
  return (
    <li className={e.kind === 'error' ? 'err' : ''}>
      <span className="who">{e.actor === 'tom' ? 'You' : e.actor.charAt(0).toUpperCase() + e.actor.slice(1)}</span>
      {e.attempt > 0 && <span className="when">round {e.attempt + 1}</span>}
      <span className="when">{fmtDateTime(e.created_at)}</span>
      <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
    </li>
  )
}
