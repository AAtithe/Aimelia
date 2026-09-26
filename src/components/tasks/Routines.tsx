'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, Routine, PRIORITY_LABEL, WEEKDAYS, cadenceText, fmtDate } from '@/lib/client/todo'

type Suggested = Omit<Routine, 'id' | 'next_due' | 'enabled' | 'created_count'> & Partial<Routine>
type Msg = { ok: boolean; text: string } | null

const BLANK = { title: '', notes: '', priority: 2, cadence: 'weekly', weekday: 0, day_of_month: 1, lead_days: 3 }

export function Routines() {
  const [rows, setRows] = useState<Routine[] | null>(null)
  const [suggested, setSuggested] = useState<Suggested[]>([])
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<{ routines: Routine[]; suggested: Suggested[] }>('/routines')
      setRows(d.routines)
      setSuggested(d.suggested)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    }
  }, [])
  useEffect(() => { load() }, [load])

  const add = async (body: any, label: string) => {
    try {
      await api('/routines', { method: 'POST', body })
      setMsg({ ok: true, text: `${label} added. The team will prepare it ahead of each due date.` })
      setEditing(null)
      load()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }

  return (
    <>
      <div className="note">
        Recurring work never needs to go on the list. Each routine creates its task a few days before it is due, and the team
        prepares it so it reaches you ready to approve. A routine that has been off does not stack up missed ones: you get the next one only.
      </div>

      <div className="card">
        <h2>Routines <span className="hcount">{rows ? rows.length : ''}</span></h2>
        {!rows ? <div className="emptyrow">Reading ...</div> : rows.length === 0 ? (
          <div className="emptyrow">No routines yet. Start with the suggestions below.</div>
        ) : (
          <div className="tblwrap">
            <table>
              <thead><tr><th>Routine</th><th className="nowrap">When</th><th className="nowrap hide-sm">Prepared</th><th className="nowrap">Next due</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  editing === r.id ? (
                    <tr key={r.id}><td colSpan={5}><RoutineForm initial={r} submitLabel="Save" onCancel={() => setEditing(null)}
                      onSubmit={async (body) => { await api(`/routines/${r.id}`, { method: 'PATCH', body }); setEditing(null); load() }}
                      onDelete={async () => { if (confirm(`Delete the routine "${r.title}"?`)) { await api(`/routines/${r.id}`, { method: 'DELETE' }); setEditing(null); load() } }} /></td></tr>
                  ) : (
                    <tr key={r.id}>
                      <td>
                        <div className="t">{r.title}{!r.enabled && <span className="pill Parked" style={{ marginLeft: 8 }}>Off</span>}</div>
                        <div className="d">{PRIORITY_LABEL[r.priority]} priority. Made {r.created_count} time{r.created_count === 1 ? '' : 's'} so far.</div>
                      </td>
                      <td className="nowrap">{cadenceText(r)}</td>
                      <td className="nowrap hide-sm">{r.lead_days} day{r.lead_days === 1 ? '' : 's'} before</td>
                      <td className="nowrap">{fmtDate(r.next_due)}</td>
                      <td className="nowrap"><button className="btn sm" onClick={() => setEditing(r.id)}>Edit</button></td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editing === 'new' ? (
          <div className="body"><RoutineForm initial={BLANK as any} submitLabel="Add routine" onCancel={() => setEditing(null)} onSubmit={(b) => add(b, b.title)} /></div>
        ) : (
          <div className="body"><button className="btn primary" onClick={() => setEditing('new')}>Add a routine</button></div>
        )}
      </div>

      {suggested.length > 0 && (
        <div className="card">
          <h2>Suggested for a CEO <span className="hcount">{suggested.length}</span></h2>
          {suggested.map((s) => (
            <div className="item" key={s.title}>
              <div className="o"><span className="tag">{cadenceText(s as Routine)}</span><span>prepared {s.lead_days} day{s.lead_days === 1 ? '' : 's'} ahead</span></div>
              <div className="t">{s.title}</div>
              <div className="meta">{s.notes}</div>
              <div className="toolbar"><button className="btn" onClick={() => add(s, s.title)}>Add this routine</button></div>
            </div>
          ))}
        </div>
      )}
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
    </>
  )
}

function RoutineForm({ initial, submitLabel, onSubmit, onCancel, onDelete }: {
  initial: Partial<Routine>; submitLabel: string; onSubmit: (b: any) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>
}) {
  const [f, setF] = useState<any>({ ...initial })
  const [err, setErr] = useState('')
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const weekly = f.cadence === 'weekly' || f.cadence === 'fortnightly'

  const submit = async () => {
    setErr('')
    try {
      await onSubmit({ title: f.title, notes: f.notes, priority: Number(f.priority), cadence: f.cadence,
        weekday: Number(f.weekday), day_of_month: Number(f.day_of_month), lead_days: Number(f.lead_days),
        ...(f.enabled !== undefined ? { enabled: f.enabled } : {}) })
    } catch (e: any) { setErr(e.message) }
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <label className="fld"><span>What needs doing</span><input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Prepare the monthly board pack" /></label>
      <label className="fld"><span>Brief for the team each time</span><textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      <div className="row2">
        <label className="fld"><span>How often</span>
          <select value={f.cadence} onChange={(e) => set('cadence', e.target.value)}>
            <option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
          </select>
        </label>
        {weekly ? (
          <label className="fld"><span>On</span>
            <select value={f.weekday} onChange={(e) => set('weekday', e.target.value)}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        ) : (
          <label className="fld"><span>Day of the month</span>
            <select value={f.day_of_month} onChange={(e) => set('day_of_month', e.target.value)}>
              {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              <option value={-1}>Last day</option>
            </select>
          </label>
        )}
        <label className="fld"><span>Prepare this many days before</span><input type="number" min={0} max={30} value={f.lead_days} onChange={(e) => set('lead_days', e.target.value)} /></label>
        <label className="fld"><span>Priority</span>
          <select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
          </select>
        </label>
      </div>
      {f.enabled !== undefined && <label className="chk"><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} />On</label>}
      <div className="toolbar">
        <button className="btn primary" disabled={!f.title?.trim()} onClick={submit}>{submitLabel}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <span className="spacer" />
        {onDelete && <button className="btn danger" onClick={() => onDelete().catch((e) => setErr(e.message))}>Delete</button>}
      </div>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
    </div>
  )
}
