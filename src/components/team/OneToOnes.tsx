'use client'

/**
 * 1-2-1 prep: one tab per direct report. The list builds itself from the task list since the last 1-2-1 (open tasks
 * naming them, what they delivered, projects, and with their email set, emails needing action and meetings), plus Tom's
 * focus points. Aimelia writes the prep sheet; Tom copies it into Employment Hero, where 1-2-1s are logged. Nothing is
 * recorded twice: marking one done only closes his points and moves the dates on.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate } from '@/lib/client/todo'
import { StatusPill } from '@/components/tasks/Cards'
import { TaskDetail } from '@/components/tasks/TaskDetail'

type PTask = { id: string; title: string | null; status: any; due_date: string | null }
type Point = { id: string; report_id: string; kind: 'focus' | 'task'; text: string; status: string; source: string; created_at: string; task: PTask | null }
type Live = { id: string; title: string; status: any; due_date: string | null; priority: number; new_since_last: boolean; flag: string | null }
export type Report = { id: string; name: string; area: string; email: string; notes: string; active: boolean; every_days: number; last_held: string | null
  next_on: string | null; prep: string | null; prep_at: string | null; points: Point[]; since: string; from_tasks: Live[]
  delivered: { id: string; title: string; done_on: string | null }[]; projects: { id: string; title: string; next_step: string }[]
  emails: { subject: string; received: string | null; action: string }[]; meetings: { subject: string; on: string | null }[]; agenda: string }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
const EVERY: [number, string][] = [[7, 'Weekly'], [14, 'Fortnightly'], [21, 'Every three weeks'], [28, 'Every four weeks']]
const label = (r: Report) => `${r.name}${r.area ? `, ${r.area}` : ''}`

function PointRow({ p, onDone, onOpenTask }: { p: Point; onDone: () => void; onOpenTask: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(p.text)
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setErr(''); onDone() } catch (e: any) { setErr(e.message) } }
  const save = () => run(async () => { await api(`/report-points/${p.id}`, { method: 'PATCH', body: { text } }); setEditing(false) })
  return (
    <li>
      {editing ? (
        <div className="toolbar">
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Point" onKeyDown={(e) => e.key === 'Enter' && text.trim() && save()} style={{ flex: 1 }} />
          <button className="btn sm primary" disabled={!text.trim()} onClick={save}>Save</button>
          <button className="btn sm" onClick={() => { setText(p.text); setEditing(false) }}>Cancel</button>
        </div>
      ) : (
        <>
          <span>{p.text}</span>
          {p.task && <> <button className="linkbtn" onClick={() => onOpenTask(p.task!.id)}>open task</button> <StatusPill status={p.task.status} />
            {p.task.due_date && <span className="when">due {fmtDate(p.task.due_date)}</span>}</>}
          {p.source === 'chat' && <span className="when">from Ask Aimelia</span>}
          <span className="when">
            <button className="linkbtn" onClick={() => setEditing(true)}>change</button>{' '}
            <button className="linkbtn" onClick={() => run(() => p.task
              ? api(`/reports/${p.report_id}/dismiss`, { method: 'POST', body: { task_id: p.task.id } }) // or it comes straight back from the task list
              : api(`/report-points/${p.id}`, { method: 'PATCH', body: { status: 'dropped' } }))}>{p.task ? 'take off' : 'drop'}</button>
          </span>
        </>
      )}
      {err && <div className="msg err">{err}</div>}
    </li>
  )
}

function Person({ r, onDone, onOpenTask }: { r: Report; onDone: () => void; onOpenTask: (id: string) => void }) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'focus' | 'task'>('focus')
  const [notes, setNotes] = useState(r.notes)
  const [email, setEmail] = useState(r.email)
  const [holding, setHolding] = useState(false)
  const [held, setHeld] = useState({ next_on: '', carry: [] as string[] })
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { setNotes(r.notes); setEmail(r.email); setHolding(false); setErr(''); setCopied(false) }, [r.id, r.notes, r.email])

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setErr('')
    try { await fn(); onDone() } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }
  const patch = (b: Record<string, unknown>) => run('patch', () => api(`/reports/${r.id}`, { method: 'PATCH', body: b }))
  const add = () => run('add', async () => { await api(`/reports/${r.id}/points`, { method: 'POST', body: { text, kind } }); setText('') })
  const notHere = (taskId: string) => run('dismiss', () => api(`/reports/${r.id}/dismiss`, { method: 'POST', body: { task_id: taskId } }))
  const markHeld = () => run('held', async () => {
    await api(`/reports/${r.id}/held`, { method: 'POST', body: { carry_over: held.carry, ...(held.next_on ? { next_on: held.next_on } : {}) } })
    setHeld({ next_on: '', carry: [] }); setHolding(false)
  })
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.prep || r.agenda); setCopied(true) } catch { setErr('The browser would not copy. Select the text and copy it instead.') }
  }
  const focus = r.points.filter((p) => p.kind === 'focus')
  const linked = r.points.filter((p) => p.kind === 'task')
  const flagged = r.from_tasks.filter((t) => t.flag)
  const steady = r.from_tasks.filter((t) => !t.flag)
  const due = r.next_on && r.next_on <= today()
  const liveRow = (t: Live) => (
    <li key={t.id}>
      <button className="linkbtn" onClick={() => onOpenTask(t.id)}>{t.title}</button> <StatusPill status={t.status} />
      {t.flag && <span className="pill Atrisk">{t.flag}</span>}
      {t.new_since_last && <span className="tag">New since last time</span>}
      {t.due_date && <span className="when">due {fmtDate(t.due_date)}</span>}
      <span className="when"><button className="linkbtn" onClick={() => notHere(t.id)}>not for {r.name}</button></span>
    </li>
  )

  return (
    <>
      <div className="card">
        <h2>{label(r)} <span className="hcount">since {fmtDate(r.since)}</span></h2>
        <div className="body">
          <div className="row2">
            <label className="fld"><span>Next 1-2-1</span>
              <input type="date" value={r.next_on || ''} onChange={(e) => patch({ next_on: e.target.value || null })} /></label>
            <label className="fld"><span>How often</span>
              <select value={r.every_days} onChange={(e) => patch({ every_days: Number(e.target.value) })}>
                {!EVERY.some(([d]) => d === r.every_days) && <option value={r.every_days}>Every {r.every_days} days</option>}
                {EVERY.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
              </select></label>
          </div>
          <p className="cap">{r.last_held ? `Last 1-2-1 ${fmtDate(r.last_held)}. The list runs from then.` : 'No 1-2-1 marked done yet, so the list covers the last 30 days.'}{due ? ' Due now.' : ''}</p>

          <div className="meta" style={{ marginTop: 12 }}>Delivered since last time</div>
          {r.delivered.length === 0 ? <p className="cap">Nothing done on the task list that names {r.name}.</p>
            : <ul className="log">{r.delivered.map((t) => <li key={t.id}><button className="linkbtn" onClick={() => onOpenTask(t.id)}>{t.title}</button>{t.done_on && <span className="when">{fmtDate(t.done_on)}</span>}</li>)}</ul>}

          <div className="meta" style={{ marginTop: 12 }}>Needs attention</div>
          {flagged.length === 0 ? <p className="cap">Nothing overdue, stuck or waiting on you.</p> : <ul className="log">{flagged.map(liveRow)}</ul>}

          <div className="meta" style={{ marginTop: 12 }}>Live work</div>
          {steady.length === 0 && linked.length === 0 && r.projects.length === 0 ? <p className="cap">No open tasks or projects name {r.name}.</p> : (
            <ul className="log">
              {linked.map((p) => <PointRow key={p.id} p={p} onDone={onDone} onOpenTask={onOpenTask} />)}
              {steady.map(liveRow)}
              {r.projects.map((p) => <li key={p.id}><span className="tag">Project</span> {p.title}{p.next_step && <span className="when">next: {p.next_step}</span>}</li>)}
            </ul>
          )}

          {(r.emails.length > 0 || r.meetings.length > 0) && (
            <>
              <div className="meta" style={{ marginTop: 12 }}>Email and meetings</div>
              <ul className="log">
                {r.emails.map((e, i) => <li key={`e${i}`}><span className="tag">Email</span> {e.subject}<span className="when">{e.action}</span></li>)}
                {r.meetings.map((m, i) => <li key={`m${i}`}><span className="tag">Meeting</span> {m.subject}{m.on && <span className="when">{fmtDate(m.on)}</span>}</li>)}
              </ul>
            </>
          )}

          <div className="meta" style={{ marginTop: 12 }}>Your focus points</div>
          {focus.length === 0 ? <p className="cap">None yet.</p> : <ul className="log">{focus.map((p) => <PointRow key={p.id} p={p} onDone={onDone} onOpenTask={onOpenTask} />)}</ul>}
          <div className="toolbar">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'focus' ? 'A focus point to raise' : 'Something that has cropped up'}
              aria-label="New point" style={{ flex: 1, minWidth: 200 }} onKeyDown={(e) => e.key === 'Enter' && text.trim() && add()} />
            <select aria-label="Kind of point" value={kind} onChange={(e) => setKind(e.target.value as 'focus' | 'task')}>
              <option value="focus">Focus point</option><option value="task">Cropped up</option>
            </select>
            <button className="btn primary sm" disabled={!text.trim() || !!busy} onClick={add}>Add</button>
          </div>
          {err && <div className="msg err">{err}</div>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Prep sheet {r.prep_at && <span className="hcount">written {fmtDate(r.prep_at)}</span>}</h2>
          <div className="body">
            {r.prep ? <div className="content">{r.prep}</div>
              : <p className="cap">Aimelia writes it from the list above: what to recognise, what needs attention, what has not moved since last time, and the coaching questions to ask.</p>}
            <div className="toolbar">
              <button className="btn primary sm" disabled={!!busy} onClick={() => run('prep', () => api(`/reports/${r.id}/prep`, { method: 'POST' }))}>
                {busy === 'prep' ? 'Writing ...' : r.prep ? 'Write it again' : 'Write my prep'}</button>
              <button className="btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy for Employment Hero'}</button>
            </div>
            <p className="cap">Copies the prep sheet, or the list if there is none, to paste into the 1-2-1 in Employment Hero.</p>
          </div>
        </div>
        <div className="card">
          <h2>After the 1-2-1</h2>
          <div className="body">
            {!holding ? (
              <>
                <p className="cap">Log the meeting in Employment Hero as usual. Here, marking it done closes your points (tick any to carry over), clears the prep sheet and starts the next list from today.</p>
                <button className="btn sm" onClick={() => setHolding(true)}>Mark it done</button>
              </>
            ) : (
              <>
                {r.points.length > 0 && <div className="meta">Carry over to next time</div>}
                {r.points.map((p) => (
                  <label key={p.id} className="chk"><input type="checkbox" checked={held.carry.includes(p.id)}
                    onChange={(e) => setHeld({ ...held, carry: e.target.checked ? [...held.carry, p.id] : held.carry.filter((x) => x !== p.id) })} />{p.text}</label>
                ))}
                <label className="fld"><span>Next 1-2-1 (in {r.every_days} days if left empty)</span>
                  <input type="date" min={today()} value={held.next_on} onChange={(e) => setHeld({ ...held, next_on: e.target.value })} /></label>
                <div className="toolbar">
                  <button className="btn primary sm" disabled={!!busy} onClick={markHeld}>{busy === 'held' ? 'Saving ...' : 'Done'}</button>
                  <button className="btn sm" onClick={() => setHolding(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>About {r.name}</h2>
        <div className="body">
          <label className="fld"><span>Standing notes: their goals, development areas, what good looks like in {r.area || 'their area'}</span>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== r.notes && patch({ notes })} /></label>
          <label className="fld"><span>Work email: picks up their emails needing action and your meetings with them</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== r.email && patch({ email })} placeholder="name@williamsstanley.co" /></label>
          <p className="cap">Used in every prep sheet. Saved when you click away.</p>
        </div>
      </div>
    </>
  )
}

function People({ reports, onDone }: { reports: Report[]; onDone: () => void }) {
  const [f, setF] = useState({ name: '', area: '' })
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); setErr(''); onDone() } catch (e: any) { setErr(e.message) } }
  return (
    <div className="card">
      <h2>Your direct reports</h2>
      <div className="body">
        <ul className="log">{reports.map((r) => (
          <li key={r.id}>
            <span>{label(r)}</span>
            <span className="when">
              <button className="linkbtn" onClick={() => { const name = prompt('Name', r.name); const area = name && prompt('Area', r.area)
                if (name && area !== null) run(() => api(`/reports/${r.id}`, { method: 'PATCH', body: { name, area } })) }}>rename</button>{' '}
              <button className="linkbtn" onClick={() => confirm(`Remove ${r.name} and their focus points? Their tasks stay.`) && run(() => api(`/reports/${r.id}`, { method: 'DELETE' }))}>remove</button>
            </span>
          </li>
        ))}</ul>
        <div className="toolbar">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" aria-label="Name" />
          <input value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Area, e.g. People" aria-label="Area" />
          <button className="btn sm" disabled={!f.name.trim()} onClick={() => run(async () => { await api('/reports', { method: 'POST', body: f }); setF({ name: '', area: '' }) })}>Add</button>
        </div>
        {err && <div className="msg err">{err}</div>}
      </div>
    </div>
  )
}

export function OneToOnes() {
  const [reports, setReports] = useState<Report[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [openTask, setOpenTask] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { const r = await api<{ reports: Report[] }>('/reports'); setReports(r.reports); setErr('') } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])
  const current = reports?.find((r) => r.id === sel) || reports?.[0] || null

  return (
    <>
      <div className="card">
        <div className="body"><div className="main-tabs" style={{ marginBottom: 0 }}>
          {(reports || []).map((r) => (
            <button key={r.id} className={`main-tab-btn ${current?.id === r.id ? 'active' : ''}`} onClick={() => setSel(r.id)}>
              {label(r)}{r.from_tasks.some((t) => t.flag) ? ` (${r.from_tasks.filter((t) => t.flag).length} to look at)` : ''}{r.next_on ? `, ${fmtDate(r.next_on)}` : ''}
            </button>
          ))}
        </div></div>
        {!reports && <div className="emptyrow">{err || 'Reading ...'}</div>}
        {reports && reports.length === 0 && <div className="emptyrow">No direct reports yet. Add them below.</div>}
      </div>
      {current && <Person r={current} onDone={load} onOpenTask={setOpenTask} />}
      {reports && <People reports={reports} onDone={load} />}
      {openTask && <TaskDetail taskId={openTask} onClose={() => { setOpenTask(null); load() }} onChanged={load} />}
    </>
  )
}
