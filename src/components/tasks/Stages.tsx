'use client'

import { useState } from 'react'
import { api, Stage, Task, fmtDate } from '@/lib/client/todo'

type Msg = { ok: boolean; text: string } | null

const heading = (s: Pick<Stage, 'kind' | 'who'>) => s.kind === 'ask' ? `Ask ${s.who}` : 'Do'

/**
 * The stage a task is on, with the box to report back: what they said (an ask), or that it is done.
 * Recording it moves the task on to its next stage with the team.
 */
export function StageItem({ s, onDone, onOpen, showTask = true, number, count, earlier }: {
  s: Stage; onDone: () => void; onOpen?: () => void; showTask?: boolean; number?: number; count?: number; earlier?: Stage['earlier']
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const n = number ?? s.stage_number
  const total = count ?? s.stage_count
  const past = (earlier ?? s.earlier ?? []).filter((e) => e.answer)
  const ask = s.kind === 'ask'

  const submit = async (skip = false) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = skip ? await api(`/stages/${s.id}/skip`, { method: 'POST' })
        : ask ? await api(`/stages/${s.id}/answer`, { method: 'POST', body: { answer: text } })
        : await api(`/stages/${s.id}/done`, { method: 'POST', body: { outcome: text } })
      const next = r.next_stage as Stage | null
      setMsg({ ok: true, text: `${skip ? 'Skipped.' : ask ? 'Answer recorded.' : 'Stage done.'} ${next
        ? `Next: ${next.kind === 'ask' ? `ask ${next.who}` : next.title}.${r.task_resumed ? ' The team is on it.' : ''}`
        : r.task_resumed ? 'That was the last stage: the team will finish the task with the answers.' : 'That was the last stage.'}` })
      setText('')
      setTimeout(onDone, 900)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="item">
      <div className="o">
        {showTask && s.task_title && <span className="tag">{s.task_title}</span>}
        {n && total ? <span>Stage {n} of {total}</span> : null}
        <span className="tag">{heading(s)}</span>
        {s.task_status === 'processing' && <span className="chip">The team is drafting the message</span>}
      </div>
      <div className="t">{s.title}</div>
      {s.details && <div className="meta">{s.details}</div>}
      {past.length > 0 && (
        <div className="meta">So far: {past.map((e) => `${e.kind === 'ask' ? `${e.who} said` : `${e.title}:`} ${e.answer}`).join('. ')}</div>
      )}
      <textarea className="inp" style={{ marginTop: 8 }} rows={2} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={ask ? `What ${s.who} said` : 'What came of it (optional)'} aria-label={ask ? `What ${s.who} said` : 'What came of it'}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (text.trim() || !ask)) submit() }} />
      <div className="toolbar">
        <button className="btn primary" disabled={busy || (ask && !text.trim())} onClick={() => submit()}>
          {ask ? 'Record the answer, next stage' : 'Done, next stage'}
        </button>
        <button className="btn" disabled={busy} onClick={() => submit(true)}>Skip this stage</button>
        {onOpen && <button className="btn ghost" onClick={onOpen}>Open the task</button>}
      </div>
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
    </div>
  )
}

/** Every stage of a task in order: what was answered, the stage it is on, what comes after, and adding more. */
export function Stages({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const stages = task.stages || []
  const current = stages.find((s) => s.status === 'open')
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<'ask' | 'do'>('ask')
  const [who, setWho] = useState('')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [draft, setDraft] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true)
    setMsg(null)
    try { await fn(); setMsg({ ok: true, text: ok }); onChanged() } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  const add = () => run(async () => {
    await api(`/tasks/${task.id}/stages`, { method: 'POST', body: { stages: [{ kind, who: kind === 'ask' ? who : '', title, details }], run_now: draft && !current } })
    setTitle(''); setDetails(''); setWho(''); setAdding(false)
  }, current ? 'Stage added after the others.' : draft ? 'Stage added. The team will draft the message for it.' : 'Stage added.')

  if (!stages.length && task.status === 'done') return null
  return (
    <>
      <h3>Stages</h3>
      {!stages.length && <p className="cap">For work that hangs on other people: go and ask someone, record what they said, and the team takes it into the next stage. The team lays stages out itself when a task needs them.</p>}
      {stages.length > 0 && (
        <ul className="log">
          {stages.map((s, i) => (
            <li key={s.id} className={s.status === 'open' && s !== current ? 'stage-later' : ''}>
              <span className="stage-n">{i + 1}.</span>
              <span className="who">{heading(s)}</span>
              <span className="when">{s.status === 'done' ? `${s.kind === 'ask' ? 'answered' : 'done'} ${fmtDate(s.done_at)}` : s.status === 'skipped' ? 'skipped' : s === current ? 'now' : 'to come'}</span>
              {s.added_by !== 'tom' && <span className="when">laid out by {s.added_by}</span>}
              <div>{s.title}</div>
              {s.answer && <div className="cap" style={{ margin: 0 }}>{s.kind === 'ask' ? `${s.who} said: ` : ''}{s.answer}</div>}
              {s.status === 'open' && s !== current && (
                <div className="toolbar" style={{ marginTop: 4 }}>
                  <button className="btn" disabled={busy} onClick={() => run(() => api(`/stages/${s.id}`, { method: 'DELETE' }), 'Stage removed.')}>Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {current && task.status !== 'done' && (
        <StageItem s={current} onDone={onChanged} showTask={false} number={stages.indexOf(current) + 1} count={stages.length} earlier={[]} />
      )}
      {current && task.status !== 'done' && (
        <div className="toolbar">
          <button className="btn" disabled={busy} onClick={() => { if (confirm('Remove the stage the task is on?')) run(() => api(`/stages/${current.id}`, { method: 'DELETE' }), 'Stage removed.') }}>Remove this stage</button>
        </div>
      )}
      {adding ? (
        <div className="item">
          <div className="row2">
            <label className="fld"><span>Stage</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as 'ask' | 'do')}>
                <option value="ask">Ask someone</option>
                <option value="do">Do something</option>
              </select></label>
            {kind === 'ask' && <label className="fld"><span>Who</span><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Mandy" /></label>}
          </div>
          <label className="fld"><span>{kind === 'ask' ? 'What to ask them' : 'What happens'}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'ask' ? 'Has the Bentleys VAT return for June gone in?' : 'Draft the reply to the client with the filing date'} /></label>
          <label className="fld"><span>Why it matters (optional)</span>
            <input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="The client wants a date before Friday" /></label>
          {!current && kind === 'ask' && (
            <label className="chk"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Have the team draft the message to {who || 'them'}</label>
          )}
          <div className="toolbar">
            <button className="btn primary" disabled={busy || !title.trim() || (kind === 'ask' && !who.trim())} onClick={add}>Add stage</button>
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : task.status !== 'done' && (
        <div className="toolbar"><button className="btn" onClick={() => setAdding(true)}>{stages.length ? 'Add a stage' : 'Work this in stages'}</button></div>
      )}
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
    </>
  )
}
