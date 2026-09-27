'use client'

/**
 * 1-2-1 prep: one tab per direct report. Each has a running list for the next 1-2-1 (focus points, and tasks that have
 * cropped up, linked to the task list), open tasks that mention them offered to add, the prep sheet Aimelia writes, and
 * a record of each 1-2-1 held. Marking one held closes what it covered and carries the rest over.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate } from '@/lib/client/todo'
import { StatusPill } from '@/components/tasks/Cards'
import { TaskDetail } from '@/components/tasks/TaskDetail'

type PTask = { id: string; title: string | null; status: any; due_date: string | null }
type Point = { id: string; kind: 'focus' | 'task'; text: string; status: string; outcome: string; source: string; created_at: string; task: PTask | null }
type Held = { id: string; held_on: string; notes: string; points: { kind: string; text: string; task_status: string | null }[] }
export type Report = { id: string; name: string; area: string; email: string; notes: string; active: boolean; every_days: number; last_held: string | null
  next_on: string | null; prep: string | null; prep_at: string | null; points: Point[]; cropped_up: (PTask & { priority: number })[]; history: Held[] }

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
            <button className="linkbtn" onClick={() => run(() => api(`/report-points/${p.id}`, { method: 'PATCH', body: { status: 'dropped' } }))}>drop</button>
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
  const [holding, setHolding] = useState(false)
  const [held, setHeld] = useState({ notes: '', next_on: '', carry: [] as string[] })
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { setNotes(r.notes); setHolding(false); setErr('') }, [r.id, r.notes])

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setErr('')
    try { await fn(); onDone() } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }
  const patch = (b: Record<string, unknown>) => run('patch', () => api(`/reports/${r.id}`, { method: 'PATCH', body: b }))
  const add = () => run('add', async () => { await api(`/reports/${r.id}/points`, { method: 'POST', body: { text, kind } }); setText('') })
  const markHeld = () => run('held', async () => {
    await api(`/reports/${r.id}/held`, { method: 'POST', body: { notes: held.notes, carry_over: held.carry, ...(held.next_on ? { next_on: held.next_on } : {}) } })
    setHeld({ notes: '', next_on: '', carry: [] }); setHolding(false)
  })
  const focus = r.points.filter((p) => p.kind === 'focus')
  const tasks = r.points.filter((p) => p.kind === 'task')
  const due = r.next_on && r.next_on <= today()

  return (
    <>
      <div className="card">
        <h2>{label(r)} <span className="hcount">{r.points.length} on the list</span></h2>
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
          <p className="cap">{r.last_held ? `Last held ${fmtDate(r.last_held)}.` : 'No 1-2-1 recorded yet.'}{due ? ' Due now.' : ''}</p>
          <div className="toolbar">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'focus' ? 'A focus point to raise' : 'A task or issue that has cropped up'}
              aria-label="New point" style={{ flex: 1, minWidth: 200 }} onKeyDown={(e) => e.key === 'Enter' && text.trim() && add()} />
            <select aria-label="Kind of point" value={kind} onChange={(e) => setKind(e.target.value as 'focus' | 'task')}>
              <option value="focus">Focus point</option><option value="task">Task that cropped up</option>
            </select>
            <button className="btn primary sm" disabled={!text.trim() || !!busy} onClick={add}>Add to the list</button>
          </div>

          <div className="meta" style={{ marginTop: 12 }}>Focus points</div>
          {focus.length === 0 ? <p className="cap">None yet.</p> : <ul className="log">{focus.map((p) => <PointRow key={p.id} p={p} onDone={onDone} onOpenTask={onOpenTask} />)}</ul>}
          <div className="meta" style={{ marginTop: 12 }}>Tasks that have cropped up</div>
          {tasks.length === 0 ? <p className="cap">None yet.</p> : <ul className="log">{tasks.map((p) => <PointRow key={p.id} p={p} onDone={onDone} onOpenTask={onOpenTask} />)}</ul>}

          {r.cropped_up.length > 0 && (
            <>
              <div className="meta" style={{ marginTop: 12 }}>In your tasks and not on the list yet</div>
              <ul className="log">{r.cropped_up.map((t) => (
                <li key={t.id}>
                  <button className="linkbtn" onClick={() => onOpenTask(t.id)}>{t.title}</button> <StatusPill status={t.status} />
                  {t.due_date && <span className="when">due {fmtDate(t.due_date)}</span>}
                  <span className="when">
                    <button className="linkbtn" onClick={() => run('add', () => api(`/reports/${r.id}/points`, { method: 'POST', body: { task_id: t.id, kind: 'task' } }))}>add to the list</button>{' '}
                    <button className="linkbtn" onClick={() => run('dismiss', () => api(`/reports/${r.id}/dismiss`, { method: 'POST', body: { task_id: t.id } }))}>not for this 1-2-1</button>
                  </span>
                </li>
              ))}</ul>
            </>
          )}
          {err && <div className="msg err">{err}</div>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Prep sheet {r.prep_at && <span className="hcount">written {fmtDate(r.prep_at)}</span>}</h2>
          <div className="body">
            {r.prep ? <div className="content">{r.prep}</div>
              : <p className="cap">Aimelia writes it from the list, where each task stands, what {r.name} delivered recently and your notes from last time: what to recognise, what to hold them to and the coaching questions to ask.</p>}
            <div className="toolbar">
              <button className="btn primary sm" disabled={!!busy} onClick={() => run('prep', () => api(`/reports/${r.id}/prep`, { method: 'POST' }))}>
                {busy === 'prep' ? 'Writing ...' : r.prep ? 'Write it again' : 'Write my prep'}</button>
            </div>
          </div>
        </div>
        <div className="card">
          <h2>After the 1-2-1</h2>
          <div className="body">
            {!holding ? (
              <>
                <p className="cap">Record it when it is done: what it covered is closed, anything you tick carries over, your notes are kept for next time and the next date is set.</p>
                <button className="btn sm" onClick={() => setHolding(true)}>It has been held</button>
              </>
            ) : (
              <>
                <label className="fld"><span>Notes: what was agreed, commitments with dates, how they are doing</span>
                  <textarea rows={5} value={held.notes} onChange={(e) => setHeld({ ...held, notes: e.target.value })} /></label>
                {r.points.length > 0 && <div className="meta">Carry over to next time</div>}
                {r.points.map((p) => (
                  <label key={p.id} className="chk"><input type="checkbox" checked={held.carry.includes(p.id)}
                    onChange={(e) => setHeld({ ...held, carry: e.target.checked ? [...held.carry, p.id] : held.carry.filter((x) => x !== p.id) })} />{p.text}</label>
                ))}
                <label className="fld"><span>Next 1-2-1 (in {r.every_days} days if left empty)</span>
                  <input type="date" min={today()} value={held.next_on} onChange={(e) => setHeld({ ...held, next_on: e.target.value })} /></label>
                <div className="toolbar">
                  <button className="btn primary sm" disabled={!!busy} onClick={markHeld}>{busy === 'held' ? 'Saving ...' : 'Save'}</button>
                  <button className="btn sm" onClick={() => setHolding(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>About {r.name}</h2>
          <div className="body">
            <label className="fld"><span>Standing notes: their goals, development areas, what good looks like in {r.area || 'their area'}</span>
              <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== r.notes && patch({ notes })} /></label>
            <p className="cap">Used in every prep sheet. Saved when you click away.</p>
          </div>
        </div>
        <div className="card">
          <h2>Past 1-2-1s</h2>
          <div className="body">
            {r.history.length === 0 ? <p className="cap">None recorded yet.</p> : r.history.map((h) => (
              <div key={h.id} style={{ marginBottom: 10 }}>
                <div className="meta"><b>{fmtDate(h.held_on)}</b>{h.points.length ? `, covered ${h.points.length} point${h.points.length === 1 ? '' : 's'}` : ''}</div>
                {h.notes && <div className="content">{h.notes}</div>}
              </div>
            ))}
          </div>
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
              <button className="linkbtn" onClick={() => confirm(`Remove ${r.name}, with their list and past 1-2-1s?`) && run(() => api(`/reports/${r.id}`, { method: 'DELETE' }))}>remove</button>
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
              {label(r)}{r.points.length ? ` (${r.points.length})` : ''}{r.next_on ? `, ${fmtDate(r.next_on)}` : ''}
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
