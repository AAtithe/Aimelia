'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, Lesson, MonthStats, fmtDate, monthLabel, KIND_LABEL } from '@/lib/todoApi'

const SOURCE_LABEL: Record<string, string> = { edit: 'You rewrote it', rejection: 'You sent it back', feedback: 'You told the team' }

export function Learning() {
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [stats, setStats] = useState<MonthStats[]>([])
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api<{ lessons: Lesson[]; stats: MonthStats[] }>('/lessons')
      setLessons(d.lessons)
      setStats(d.stats)
    } catch (e: any) { setErr(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = async (l: Lesson) => {
    try { await api(`/lessons/${l.id}`, { method: 'PATCH', body: { active: !l.active } }); load() } catch (e: any) { setErr(e.message) }
  }

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–')

  return (
    <>
      <div className="note">
        Every time you rewrite a draft, send one back or tell the team what to change, it is kept as a lesson. The most recent lessons go to
        every agent on every task, so a correction made once should not be needed twice. If the team is learning, the share you
        edit or send back falls month on month.
      </div>

      <div className="card">
        <h2>Is the team learning?</h2>
        <div className="tblwrap">
          <table>
            <thead><tr><th>Month</th><th className="numcell nowrap">Delivered</th><th className="numcell nowrap">Approved as they stood</th><th className="numcell nowrap">You edited</th><th className="numcell nowrap">You sent back</th></tr></thead>
            <tbody>
              {stats.map((m) => (
                <tr key={m.month}>
                  <td className="nowrap">{monthLabel(m.month)}</td>
                  <td className="numcell num">{m.delivered || '–'}</td>
                  <td className="numcell num">{m.delivered ? `${m.approved_as_is} (${pct(m.approved_as_is, m.delivered)})` : '–'}</td>
                  <td className="numcell num">{m.delivered ? `${m.edited} (${pct(m.edited, m.delivered)})` : '–'}</td>
                  <td className="numcell num">{m.delivered ? `${m.sent_back} (${pct(m.sent_back, m.delivered)})` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="body"><p className="cap" style={{ margin: 0 }}>A dash means nothing was delivered that month, so there is nothing to measure. Actions still waiting for you count as delivered but not yet approved.</p></div>
      </div>

      <div className="card">
        <h2>Lessons <span className="hcount">{lessons ? `${lessons.filter((l) => l.active).length} in use` : ''}</span></h2>
        {!lessons ? <div className="emptyrow">Reading ...</div> : lessons.length === 0 ? (
          <div className="emptyrow">No lessons yet. They appear the first time you edit or send back the team&apos;s work.</div>
        ) : lessons.map((l) => (
          <div className={`item`} key={l.id} style={{ opacity: l.active ? 1 : 0.55 }}>
            <div className="o">
              <span className="tag">{SOURCE_LABEL[l.source] || l.source}</span>
              {l.action_kind && <span className="tag">{KIND_LABEL[l.action_kind] || l.action_kind}</span>}
              <span>{l.task_title}</span><span>{fmtDate(l.created_at)}</span>
              {!l.active && <span className="pill Parked">Not in use</span>}
            </div>
            {l.note && <div className="t" style={{ fontWeight: 400 }}>{l.note}</div>}
            {l.source === 'edit' && (
              <div className="row2" style={{ gap: 10 }}>
                <div><div className="meta">The team wrote</div><div className="content">{l.before}</div></div>
                <div><div className="meta">You changed it to</div><div className="content">{l.after}</div></div>
              </div>
            )}
            <div className="toolbar"><button className="btn sm" onClick={() => toggle(l)}>{l.active ? 'Stop using this lesson' : 'Use this lesson again'}</button></div>
          </div>
        ))}
      </div>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
    </>
  )
}
