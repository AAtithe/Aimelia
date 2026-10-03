'use client'

import { useState } from 'react'
import { useShell } from '@/components/Shell'
import { ANSWER_ACCEPT, attachToQuestion } from './Documents'
import { api, Action, Question, Task, KIND_LABEL, STATUS_LABEL, STATUS_PILL, TaskStatus, fmtDate } from '@/lib/client/todo'

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`pill ${STATUS_PILL[status]}`}>{STATUS_LABEL[status]}</span>
}

type Msg = { ok: boolean; text: string } | null

function MsgLine({ msg }: { msg: Msg }) {
  return <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
}

/**
 * A question from the team. Answer in words, with files (screenshots, documents, transcripts, exported chats), or
 * both: pick them, drop them on the question, or paste a screenshot straight into the answer box.
 */
export function QuestionItem({ q, onDone, showTask = true }: { q: Question; onDone: () => void; showTask?: boolean }) {
  const [answer, setAnswer] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const add = (list: FileList | File[] | null) => {
    const picked = Array.from(list || []).map((f, i) => f.name && f.name !== 'image.png' ? f
      : new File([f], `Screenshot ${new Date().toLocaleTimeString('en-GB').replace(/:/g, '.')}${i ? ` ${i + 1}` : ''}.png`, { type: f.type }))
    if (picked.length) setFiles((have) => [...have, ...picked].slice(0, 10))
  }
  const ready = !!answer.trim() || files.length > 0

  const submit = async (dismiss = false) => {
    setBusy(true)
    setMsg(null)
    try {
      if (!dismiss && files.length) {
        setMsg({ ok: true, text: `Sending ${files.length} file${files.length === 1 ? '' : 's'} ...` })
        await attachToQuestion(q.id, files)
      }
      const res = dismiss
        ? await api(`/questions/${q.id}/dismiss`, { method: 'POST' })
        : await api(`/questions/${q.id}/answer`, { method: 'POST', body: { answer } })
      const n = res.tasks_resumed || 0
      const withFiles = res.files ? ` Claude reads the file${res.files === 1 ? '' : 's'} first, then the team uses ${res.files === 1 ? 'it' : 'them'}.` : ''
      setFiles([])
      setMsg({ ok: true, text: dismiss ? (n ? 'Skipped. The team will use its judgement.' : 'Skipped.')
        : (n > 1 ? `Answered. ${n} tasks have gone back to the team.` : res.task_resumed || n ? 'Answered. The team has picked it back up.' : 'Answered. Other questions on this task are still open.') + withFiles })
      setTimeout(onDone, 900)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`item ${dragging ? 'dropping' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); add(e.dataTransfer.files) } }}>
      <div className="o">
        {showTask && <span className="tag">{q.task_title}</span>}
        {(q.also_for || []).map((t) => <span key={t.task_id} className="tag">{t.title}</span>)}
        <span>Asked by {q.asked_by}</span>
        {q.updated_at && <span className="chip">Updated by Aimelia</span>}
      </div>
      <div className="t">{q.question}</div>
      {q.why && <div className="meta">Why it matters: {q.why}</div>}
      {q.shared_with && <div className="meta">Shared with {q.shared_with.title}. One answer settles both.</div>}
      {!!q.also_for?.length && <div className="meta">One answer settles this for {q.also_for.length + 1} tasks.</div>}
      {q.suggested_answer && (
        <div className="note info" style={{ margin: '8px 0 0' }}>
          Suggested from what you said before{q.suggested_from ? ` (${q.suggested_from})` : ''}: {q.suggested_answer}
          <div className="toolbar"><button className="btn" disabled={busy} onClick={() => setAnswer(q.suggested_answer!)}>Use this answer</button></div>
        </div>
      )}
      <textarea className="inp" style={{ marginTop: 8 }} rows={2} placeholder="Your answer, or paste a chat or transcript. Paste or drop screenshots and files here too." value={answer}
        aria-label="Your answer" onChange={(e) => setAnswer(e.target.value)}
        onPaste={(e) => { const f = Array.from(e.clipboardData.files || []); if (f.length) { e.preventDefault(); add(f) } }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready) submit() }} />
      {files.length > 0 && (
        <div className="answer-files">
          {files.map((f, i) => (
            <span key={i} className="answer-file">{f.name} <span className="cap">{f.size < 1048576 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1048576).toFixed(1)} MB`}</span>
              <button type="button" className="linkbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button></span>
          ))}
        </div>
      )}
      <div className="toolbar">
        <button className="btn primary" disabled={busy || !ready} onClick={() => submit()}>{files.length && !answer.trim() ? 'Answer with the files' : 'Answer'}</button>
        <label className="btn">Attach files<input type="file" multiple accept={ANSWER_ACCEPT} hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} /></label>
        <button className="btn" disabled={busy} onClick={() => submit(true)}>Skip, use your judgement</button>
      </div>
      <MsgLine msg={msg} />
    </div>
  )
}

type ItemProps = { a: Action; onDone: () => void; showTask?: boolean }

/** A draft to approve, or once approved, the thing to carry out. */
export function ActionItem(props: ItemProps) {
  return props.a.status === 'approved' ? <ToDoItem {...props} /> : <DraftItem {...props} />
}

function DraftItem({ a, onDone, showTask = true }: ItemProps) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(a.content)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  // A decision or note is settled by approving it; the card stays open so Tom can say what comes of it.
  const [settled, setSettled] = useState(false)
  const live = a.status === 'proposed' && !settled
  const flagged = a.review_status === 'flagged'
  const d = a.details || {}
  // Only offered once Microsoft 365 is connected; until then, Copy puts the draft on the clipboard.
  const canOutlook = a.kind === 'email_draft' && !!d.to && !!useShell().microsoft?.connected

  const run = async (fn: () => Promise<any>, ok: string, refresh = true) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: ok })
      if (refresh) setTimeout(onDone, 900)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const copy = () => run(async () => {
    const head = a.kind === 'email_draft'
      ? [d.to && `To: ${d.to}`, d.cc && `Cc: ${d.cc}`, d.subject && `Subject: ${d.subject}`].filter(Boolean).join('\n')
      : ''
    await navigator.clipboard.writeText([head, content].filter(Boolean).join('\n\n'))
  }, 'Copied to the clipboard.', false)

  return (
    <div className={`item ${flagged && live ? 'flag' : ''}`}>
      <div className="o">
        {showTask && <span className="tag">{a.task_title}</span>}
        <span className="tag">{KIND_LABEL[a.kind] || a.kind}</span>
        {a.review_score !== null && (
          <span className={`pill ${flagged ? 'Overdue' : 'Ontrack'}`}>
            {flagged ? 'Reviewer not satisfied' : 'Reviewer approved'} {a.review_score}/10
          </span>
        )}
        {!live && <span className="pill Parked">{a.status === 'approved' ? 'Approved' : a.status === 'done' ? 'Done' : 'Sent back'}</span>}
      </div>
      <div className="t">{a.title}</div>
      {a.kind === 'email_draft' && (d.to || d.subject) && (
        <div className="meta">
          {d.to && <>To <b>{d.to}</b>{d.cc ? <> , cc <b>{d.cc}</b></> : null}. </>}
          {d.subject && <>Subject <b>{d.subject}</b></>}
        </div>
      )}
      {a.kind === 'delegate' && (d.owner || d.due) && (
        <div className="meta">
          {d.owner && <>Owner <b>{d.owner}</b>. </>}
          {d.due && <>Back by <b>{fmtDate(d.due)}</b></>}
        </div>
      )}
      {editing
        ? <textarea className="inp mono" style={{ marginTop: 8 }} rows={12} value={content} onChange={(e) => setContent(e.target.value)} aria-label="Edit content" />
        : <div className="content">{content}</div>}
      {a.review_notes && live && (
        <div className={`note ${flagged ? 'bad' : 'info'}`} style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{a.review_notes}</div>
      )}
      {a.user_feedback && <div className="meta" style={{ marginTop: 6 }}>Your feedback: {a.user_feedback}</div>}

      {live && (
        <div className="toolbar">
          {editing ? (
            <>
              <button className="btn primary" disabled={busy} onClick={() => run(() => api(`/actions/${a.id}`, { method: 'PATCH', body: { content } }).then(() => setEditing(false)), 'Saved.', false)}>Save</button>
              <button className="btn" onClick={() => { setContent(a.content); setEditing(false) }}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn primary" disabled={busy} onClick={() => TO_DO_WORDS[a.kind]
                ? run(() => api(`/actions/${a.id}/approve`, { method: 'POST', body: {} }), `Approved. It is in To do: ${TO_DO_WORDS[a.kind].next}.`)
                : run(() => api(`/actions/${a.id}/approve`, { method: 'POST', body: {} }).then(() => setSettled(true)), 'Approved and settled. Anything that follows from it?', false)}>
                {a.kind === 'delegate' ? 'Approve handover' : 'Approve'}
              </button>
              {canOutlook && (
                <button className="btn" disabled={busy} onClick={() => run(() => api(`/actions/${a.id}/approve`, { method: 'POST', body: { create_outlook_draft: true } }), 'Approved. The draft is in your Outlook drafts, not sent. It is in To do until you mark it sent.')}>
                  Approve and put in Outlook drafts
                </button>
              )}
              <button className="btn" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn" onClick={copy}>Copy</button>
              <span className="spacer" />
              <button className="btn danger" onClick={() => setRejecting(!rejecting)}>Send back</button>
            </>
          )}
        </div>
      )}
      {rejecting && (
        <div style={{ marginTop: 10 }}>
          <label className="fld"><span>What should the team change?</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Firmer tone, mention the 30-day notice period" />
          </label>
          <button className="btn primary" disabled={busy || !reason.trim()} onClick={() => run(() => api(`/actions/${a.id}/reject`, { method: 'POST', body: { reason, rework: true } }), 'Sent back. The team will rework it.')}>
            Send back with this note
          </button>
        </div>
      )}
      <MsgLine msg={msg} />
      {settled && <NextStep a={{ ...a, status: 'done' }} onDone={onDone} startOpen nothingNext />}
      {!live && !settled && a.status === 'done' && <NextStep a={a} onDone={onDone} />}
    </div>
  )
}

/** What Tom does with each kind once approved, and what the buttons say. */
const TO_DO_WORDS: Record<string, { next: string; how: (d: Record<string, any>) => string; done: string; noCheck?: string }> = {
  email_draft: { next: 'send it, then mark it sent',
    how: (d) => d.outlook_draft_id ? 'It is in your Outlook drafts. Send it from Outlook, then mark it sent.' : 'Send it: open it in your email or copy it, then mark it sent.',
    done: 'Sent, check for a reply', noCheck: 'Sent, no check needed' },
  call: { next: 'book or make the call, then mark it done', how: () => 'Book or make the call, then mark it done.', done: 'Done, check it happened', noCheck: 'Done, no check needed' },
  delegate: { next: 'send the handover, then mark it sent',
    how: (d) => `Send the handover${d.owner ? ` to ${d.owner}` : ''}, then mark it sent. Aimelia checks it came back${d.due ? ` by ${fmtDate(d.due)}` : ' in a week'}.`,
    done: 'Sent, check it comes back', noCheck: 'Sent, no check needed' },
  document: { next: 'use it, then mark it done', how: () => 'Use it: copy it into Word or send it on, then mark it done.', done: 'Done' },
  checklist: { next: 'work through it, then mark it done', how: () => 'Work through it, ticking each step, then mark it done.', done: 'Done' },
}

const STEP = /^\s*(?:[-*•]|\d+[.)]|\[[ x]?\])\s+/i
const mailto = (d: Record<string, any>, body: string) =>
  `mailto:${encodeURIComponent(String(d.to || '')).replace(/%40/g, '@').replace(/%2C/g, ',')}?${[d.cc && `cc=${encodeURIComponent(d.cc)}`,
    `subject=${encodeURIComponent(d.subject || '')}`, `body=${encodeURIComponent(body.slice(0, 1800))}`].filter(Boolean).join('&')}`

/** An approved action waiting for Tom to carry it out. */
function ToDoItem({ a, onDone, showTask = true }: ItemProps) {
  const w = TO_DO_WORDS[a.kind] || { next: 'carry it out', how: () => 'Carry it out, then mark it done.', done: 'Done' }
  const d = a.details || {}
  const lines = a.kind === 'checklist' ? a.content.split('\n').filter((l) => l.trim()) : []
  const [ticked, setTicked] = useState<number[]>(Array.isArray(d.ticked) ? d.ticked : [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const allTicked = lines.length > 0 && lines.every((l, i) => !STEP.test(l) || ticked.includes(i))

  const done = async (followUp: boolean) => {
    setBusy(true); setMsg(null)
    try {
      const r = await api(`/actions/${a.id}/done`, { method: 'POST', body: { follow_up: followUp } })
      setMsg({ ok: true, text: r.follow_up_on ? `Done. Aimelia checks on ${fmtDate(r.follow_up_on)}; it will be in Follow-ups.` : 'Done.' })
      setTimeout(onDone, 1100)
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }
  const tick = async (i: number) => {
    const next = ticked.includes(i) ? ticked.filter((x) => x !== i) : [...ticked, i]
    setTicked(next)
    try { await api(`/actions/${a.id}`, { method: 'PATCH', body: { details: { ...d, ticked: next } } }) } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const copy = async () => {
    const head = a.kind === 'email_draft' ? [d.to && `To: ${d.to}`, d.cc && `Cc: ${d.cc}`, d.subject && `Subject: ${d.subject}`].filter(Boolean).join('\n') : ''
    try { await navigator.clipboard.writeText([head, a.content].filter(Boolean).join('\n\n')); setMsg({ ok: true, text: 'Copied to the clipboard.' }) }
    catch { setMsg({ ok: false, text: 'The browser would not copy. Select the text and copy it.' }) }
  }

  return (
    <div className="item todo">
      <div className="o">
        {showTask && <span className="tag">{a.task_title}</span>}
        <span className="tag">{KIND_LABEL[a.kind] || a.kind}</span>
        {a.approved_at && <span>Approved {fmtDate(a.approved_at)}</span>}
      </div>
      <div className="t">{a.title}</div>
      <div className="meta todo-how">{w.how(d)}</div>
      {a.kind === 'email_draft' && (d.to || d.subject) && (
        <div className="meta">{d.to && <>To <b>{d.to}</b>{d.cc ? <>, cc <b>{d.cc}</b></> : null}. </>}{d.subject && <>Subject <b>{d.subject}</b></>}</div>
      )}
      {lines.length > 0 ? (
        <ul className="todo-steps">
          {lines.map((l, i) => STEP.test(l)
            ? <li key={i}><label className="chk"><input type="checkbox" checked={ticked.includes(i)} onChange={() => tick(i)} /><span className={ticked.includes(i) ? 'struck' : ''}>{l.replace(STEP, '')}</span></label></li>
            : <li key={i} className="plain">{l}</li>)}
        </ul>
      ) : <div className="content">{a.content}</div>}
      <div className="toolbar">
        {a.kind === 'email_draft' && d.to && !d.outlook_draft_id && <a className="btn" href={mailto(d, a.content)}>Open in email</a>}
        <button className="btn" onClick={copy}>Copy</button>
        <button className={`btn ${lines.length && !allTicked ? '' : 'primary'}`} disabled={busy} onClick={() => done(true)}>{w.done}</button>
        {w.noCheck && <button className="btn" disabled={busy} onClick={() => done(false)}>{w.noCheck}</button>}
      </div>
      <MsgLine msg={msg} />
      <NextStep a={a} onDone={onDone} />
    </div>
  )
}

/** Wall-clock London date and time as an iCalendar value with no zone, which a phone or Outlook reads as local time. */
const icsTime = (date: string, time: string) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n')

function downloadIcs(e: { subject: string; date: string; start: string; end: string; allDay: boolean; location: string; notes: string }) {
  const next = new Date(Date.parse(`${e.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
  const end = e.end || `${String(Math.min(Number(e.start.slice(0, 2)) + 1, 23)).padStart(2, '0')}:${e.start.slice(3)}`
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Williams Stanley//Aimelia//EN', 'BEGIN:VEVENT',
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@aimelia`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    ...(e.allDay ? [`DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next.replace(/-/g, '')}`]
      : [`DTSTART:${icsTime(e.date, e.start)}`, `DTEND:${icsTime(e.date, end)}`]),
    `SUMMARY:${icsText(e.subject)}`, ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []), `DESCRIPTION:${icsText(e.notes.slice(0, 2000))}`,
    'END:VEVENT', 'END:VCALENDAR']
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${e.subject.replace(/[^\w ]+/g, '').trim().slice(0, 60) || 'event'}.ics`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * What comes of an approved item. Roll it on: the team works the next step on the same task (book the flights the
 * team worked out), with what was approved in front of it. Add tasks that follow on from it. Put it in the diary.
 */
export function NextStep({ a, onDone, startOpen = false, nothingNext = false }: { a: Action; onDone: () => void; startOpen?: boolean; nothingNext?: boolean }) {
  const outlook = !!useShell().microsoft?.connected
  const [open, setOpen] = useState(startOpen)
  const [rollOn, setRollOn] = useState('')
  const [lines, setLines] = useState('')
  const [markDone, setMarkDone] = useState(true)
  const [diary, setDiary] = useState(false)
  const [ev, setEv] = useState({ subject: a.title.slice(0, 200), date: '', start: '09:00', end: '', allDay: false, location: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const approved = a.status === 'approved'
  const tasks = lines.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean)

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await api(`/actions/${a.id}/next`, { method: 'POST', body: { roll_on: rollOn, tasks: tasks.map((title) => ({ title })), done: approved && markDone, follow_up: true } })
      const n = r.created?.length || 0
      setMsg({ ok: true, text: [rollOn.trim() && 'Rolled on: the team is working the next step on this task.', n && `${n} task${n === 1 ? '' : 's'} added, each carrying what you approved.`,
        r.follow_up_on && `Aimelia checks on ${fmtDate(r.follow_up_on)}.`].filter(Boolean).join(' ') })
      setRollOn(''); setLines('')
      setTimeout(onDone, 1400)
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }
  const book = async () => {
    setBusy(true); setMsg(null)
    const e = { ...ev, notes: `${a.title}\n\n${a.content}` }
    try {
      if (outlook) {
        await api(`/actions/${a.id}/diary`, { method: 'POST', body: { subject: e.subject, date: e.date, all_day: e.allDay, location: e.location,
          ...(e.allDay ? {} : { start: e.start, ...(e.end ? { end: e.end } : {}) }) } })
        setMsg({ ok: true, text: `In your Outlook calendar on ${fmtDate(e.date)}${e.allDay ? '' : ` at ${e.start}`}.` })
      } else {
        downloadIcs(e)
        setMsg({ ok: true, text: 'Calendar file downloaded: open it to add it to your diary.' })
      }
      setDiary(false)
    } catch (err: any) { setMsg({ ok: false, text: err.message }) } finally { setBusy(false) }
  }

  if (!open) return (
    <div className="toolbar"><button className="btn ghost" onClick={() => setOpen(true)}>What next: roll it on, add a task, put it in the diary</button></div>
  )
  return (
    <div className="nextstep">
      <div className="nextstep-h">What comes of it</div>
      <label className="fld"><span>Roll it on: the next step for the team on this task</span>
        <textarea rows={2} value={rollOn} onChange={(e) => setRollOn(e.target.value)} placeholder="Book the flights for those times, economy plus, and draft the hotel booking" /></label>
      <label className="fld"><span>Or add new tasks that follow on, one per line</span>
        <textarea rows={2} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'Arrange airport transfers\nTell Mandy I am away those days'} /></label>
      {approved && <label className="chk"><input type="checkbox" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} /> Mark this one done</label>}
      <div className="toolbar">
        <button className="btn primary" disabled={busy || (!rollOn.trim() && !tasks.length)} onClick={save}>Save what comes next</button>
        <button className="btn" disabled={busy} onClick={() => setDiary(!diary)}>{diary ? 'Not the diary' : 'Put it in my diary'}</button>
        {nothingNext ? <button className="btn" disabled={busy} onClick={onDone}>Nothing follows</button>
          : <button className="btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>}
      </div>
      {diary && (
        <div className="nextstep-diary">
          <label className="fld"><span>In the diary as</span><input value={ev.subject} onChange={(e) => setEv({ ...ev, subject: e.target.value })} placeholder="Flight BA 117 to New York" /></label>
          <div className="row2">
            <label className="fld"><span>Day</span><input type="date" value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })} /></label>
            {!ev.allDay && <label className="fld"><span>From</span><input type="time" value={ev.start} onChange={(e) => setEv({ ...ev, start: e.target.value })} /></label>}
            {!ev.allDay && <label className="fld"><span>To (optional)</span><input type="time" value={ev.end} onChange={(e) => setEv({ ...ev, end: e.target.value })} /></label>}
          </div>
          <label className="fld"><span>Where (optional)</span><input value={ev.location} onChange={(e) => setEv({ ...ev, location: e.target.value })} placeholder="Heathrow Terminal 5" /></label>
          <label className="chk"><input type="checkbox" checked={ev.allDay} onChange={(e) => setEv({ ...ev, allDay: e.target.checked })} /> All day</label>
          <div className="toolbar">
            <button className="btn primary" disabled={busy || !ev.subject.trim() || !ev.date || (!ev.allDay && !ev.start)} onClick={book}>
              {outlook ? 'Add to my Outlook calendar' : 'Download for my calendar'}
            </button>
          </div>
        </div>
      )}
      <MsgLine msg={msg} />
    </div>
  )
}

const FOLLOW_UP_WORDS = {
  delegate: { tag: (o: string) => `Handed to ${o}`, ask: 'Has it come back, and is it right?', done: 'Delivered, close it', closed: 'Closed. The original task is closed too.',
    chase: 'Not yet, draft a chaser', show: 'the handover that was sent' },
  email: { tag: (o: string) => `Emailed ${o}`, ask: 'Have they replied, and is it settled?', done: 'Settled, close it', closed: 'Closed. The original task is closed too.',
    chase: 'No reply, draft a chaser', show: 'the email you approved' },
  call: { tag: (o: string) => `Call with ${o}`, ask: 'Did the call happen, and is everything from it on the list?', done: 'Done, close it', closed: 'Closed. The original task is closed too.',
    chase: 'Not yet, draft a nudge', show: 'the call you approved' },
}

export function FollowUpItem({ t, onDone }: { t: Task; onDone: () => void }) {
  const w = FOLLOW_UP_WORDS[t.follow_up_type || 'delegate'] || FOLLOW_UP_WORDS.delegate
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [show, setShow] = useState(false)

  const go = async (outcome: 'delivered' | 'chase' | 'snooze' | 'now', ok: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await api(`/tasks/${t.id}/follow-up`, { method: 'POST', body: { outcome, days: 7 } })
      setMsg({ ok: true, text: ok })
      setTimeout(onDone, 900)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="item">
      <div className="o"><span className="tag">{w.tag(t.follow_up_owner || 'the owner')}</span><span>Due back {fmtDate(t.due_date)}</span></div>
      <div className="t">{t.title}</div>
      <div className="meta">{w.ask}</div>
      {t.handover && (
        <>
          <button className="linkbtn" style={{ marginTop: 6 }} onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'} {w.show}</button>
          {show && <div className="content">{t.notes || t.handover}</div>}
        </>
      )}
      <div className="toolbar">
        <button className="btn primary" disabled={busy} onClick={() => go('delivered', w.closed)}>{w.done}</button>
        <button className="btn" disabled={busy} onClick={() => go('chase', 'The team is drafting a chaser for you to approve.')}>{w.chase}</button>
        <button className="btn" disabled={busy} onClick={() => go('snooze', 'Checking again in a week.')}>Give it another week</button>
      </div>
      <MsgLine msg={msg} />
    </div>
  )
}

/**
 * Dictation into a text box, using the browser's own speech recognition
 * (Chrome, Edge and Safari on iPhone). Nothing is recorded or uploaded by us.
 */
export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [listening, setListening] = useState(false)
  const [err, setErr] = useState('')
  const [rec, setRec] = useState<any>(null)

  const start = () => {
    const SR = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    if (!SR) {
      setErr('This browser cannot take dictation. Use Chrome, Edge or Safari, or the dictation key on your phone keyboard.')
      return
    }
    const r = new SR()
    r.lang = 'en-GB'
    r.continuous = true
    r.interimResults = false
    r.onresult = (e: any) => {
      let said = ''
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += e.results[i][0].transcript
      if (said.trim()) onText(said.trim())
    }
    r.onerror = (e: any) => { setErr(e.error === 'not-allowed' ? 'Microphone access was refused. Allow it in the browser settings.' : `Dictation stopped: ${e.error}`); setListening(false) }
    r.onend = () => setListening(false)
    setErr('')
    r.start()
    setRec(r)
    setListening(true)
  }

  const stop = () => { rec?.stop(); setListening(false) }

  return (
    <>
      <button type="button" className={`btn ${listening ? 'danger' : ''}`} onClick={listening ? stop : start} aria-pressed={listening}>
        {listening ? 'Stop dictating' : 'Dictate'}
      </button>
      {err && <span className="msg err" style={{ margin: 0 }}>{err}</span>}
    </>
  )
}
