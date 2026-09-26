'use client'

import { useState } from 'react'
import { mail } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { useLoad } from '@/components/mail/common'

const URGENCY = ['', 'Very low', 'Low', 'Medium', 'High', 'Critical']

function Bars({ rows, label, value }: { rows: any[]; label: (r: any) => string; value: (r: any) => number }) {
  const max = Math.max(1, ...rows.map(value))
  if (!rows.length) return <div className="emptyrow">Nothing measured in this window yet.</div>
  return (
    <div className="body">{rows.map((r, i) => (
      <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 40px', gap: 10, alignItems: 'center', margin: '5px 0', fontSize: 12.5 }}>
        <span>{label(r)}</span><div className="bartrack"><div className="bar" style={{ width: `${(value(r) / max) * 100}%` }} /></div>
        <span className="num" style={{ textAlign: 'right' }}>{value(r)}</span>
      </div>))}</div>
  )
}

export default function Analytics() {
  const [days, setDays] = useState(30)
  const { data } = useLoad(() => mail(`/analytics?days=${days}`), [days])
  const t = data?.totals
  const none = (n?: number) => (n ? '' : 'none')
  return (
    <Shell title="Analytics" sub="What Aimelia has actually done, from its own records. Nothing here is estimated.">
      <div className="toolbar" style={{ marginTop: 0, marginBottom: 12 }}>
        {[7, 30, 90].map((d) => <button key={d} className={`btn sm ${days === d ? 'primary' : ''}`} onClick={() => setDays(d)}>Last {d} days</button>)}
      </div>
      <div className="kpis">
        <div className={`kpi ${none(t?.emails)}`}><span className="n">{t ? t.emails : '–'}</span><span className="l">Emails sorted</span></div>
        <div className={`kpi ${none(t?.urgent)}`}><span className="n">{t ? t.urgent : '–'}</span><span className="l">Urgent</span></div>
        <div className={`kpi ${none(t?.drafts)}`}><span className="n">{t ? t.drafts : '–'}</span><span className="l">Reply drafts</span></div>
        <div className={`kpi ${none(t?.briefs)}`}><span className="n">{t ? t.briefs : '–'}</span><span className="l">Meeting briefs</span></div>
        <div className={`kpi ${none(t?.tasks_created)}`}><span className="n">{t ? t.tasks_created : '–'}</span><span className="l">Tasks added</span></div>
        <div className={`kpi ${none(t?.tasks_done)}`}><span className="n">{t ? t.tasks_done : '–'}</span><span className="l">Tasks closed</span></div>
      </div>
      {t && t.emails > 0 && <div className="note">When AI sorted an email it was on average <b>{Math.round(t.ai_confidence * 100)}%</b> sure. Rules sort the rest instantly.</div>}
      {data && (
        <div className="grid2">
          <div className="card"><h2>By category</h2><Bars rows={data.by_category} label={(r) => r.category} value={(r) => r.n} /></div>
          <div className="card"><h2>By urgency</h2><Bars rows={data.by_urgency} label={(r) => URGENCY[r.urgency] || String(r.urgency)} value={(r) => r.n} /></div>
          <div className="card"><h2>How it was sorted</h2><Bars rows={data.by_method} label={(r) => (r.method === 'ai' ? 'AI' : r.method === 'rules' ? 'Keyword rules' : 'Could not sort')} value={(r) => r.n} /></div>
          <div className="card"><h2>Mail per day, last 14 days</h2><Bars rows={data.per_day} label={(r) => new Date(`${r.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} value={(r) => r.n} /></div>
        </div>
      )}
    </Shell>
  )
}
