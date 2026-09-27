'use client'

/**
 * The work planner: the week Monday to Friday, free time after meetings, what is planned each day, what is due and what
 * comes back, the tasks still to plan, and Plan my week (a proposal Tom uses or dismisses).
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, PRIORITY_LABEL } from '@/lib/client/todo'
import { useShell } from '@/components/Shell'
import { TaskDetail } from '@/components/tasks/TaskDetail'

type PTask = { id: string; title: string; status: string; priority: number; due_date: string | null; planned_for: string | null; estimate_minutes: number | null
  project: string | null; kind: string; calendar_event: { start: string } | null; slipped?: boolean }
type Day = { date: string; past: boolean; today: boolean; work_minutes: number; busy_minutes: number | null; meetings: number | null; free_minutes: number
  planned_minutes: number; over_by: number; planned: PTask[]; due: PTask[]; coming_back: { kind: string; id: string; title: string }[] }
type Plan = { id: string; summary: string; by: 'ai' | 'plain'; plan: { task_id: string; title?: string; day: string; minutes: number; why: string }[]
  not_this_week: { task_id: string; title?: string; why: string }[]; warnings: string[] }
type Week = { week: string; today: string; calendar: boolean; days: Day[]; to_plan: PTask[]; slipped: PTask[]; latest_plan: Plan | null }

const hm = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`)
const dayName = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace('Sep ', 'Sept ')
const shift = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

function TaskRow({ t, days, onChange, onOpen, calendar }: { t: PTask; days: Day[]; onChange: () => void; onOpen: (id: string) => void; calendar: boolean }) {
  const [err, setErr] = useState('')
  const patch = async (b: Record<string, unknown>) => { try { await api(`/tasks/${t.id}`, { method: 'PATCH', body: b }); onChange() } catch (e: any) { setErr(e.message) } }
  const book = async () => {
    try { await api(`/tasks/${t.id}/book`, { method: 'POST', body: { on: t.planned_for, minutes: t.estimate_minutes || undefined } }); onChange() } catch (e: any) { setErr(e.message) }
  }
  return (
    <div className="item">
      <div className="o">
        <span>{PRIORITY_LABEL[t.priority]}</span>
        {t.due_date && <span>due {fmtDate(t.due_date)}</span>}
        {t.project && <span className="tag">{t.project}</span>}
        {t.slipped && <span className="pill Atrisk">Slipped</span>}
        {t.calendar_event && <span className="pill Done">Focus booked</span>}
      </div>
      <button className="linkbtn t" style={{ textAlign: 'left' }} onClick={() => onOpen(t.id)}>{t.title}</button>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <select value={t.planned_for && days.some((d) => d.date === t.planned_for) ? t.planned_for : ''} aria-label="Plan for"
          onChange={(e) => patch({ planned_for: e.target.value || null })}>
          <option value="">Not planned</option>
          {days.filter((d) => !d.past).map((d) => <option key={d.date} value={d.date}>{dayName(d.date)}</option>)}
        </select>
        <select value={t.estimate_minutes ?? ''} aria-label="How long" onChange={(e) => patch({ estimate_minutes: e.target.value ? Number(e.target.value) : null })}>
          <option value="">How long?</option>
          {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{hm(m)}</option>)}
        </select>
        {calendar && t.planned_for && !t.calendar_event && <button className="btn sm" onClick={book}>Book focus time</button>}
      </div>
      {err && <div className="msg err">{err}</div>}
    </div>
  )
}

function Proposal({ plan, days, onDone }: { plan: Plan; days: Day[]; onDone: () => void }) {
  const [err, setErr] = useState('')
  const act = async (what: 'apply' | 'dismiss') => { try { await api(`/planner/plans/${plan.id}/${what}`, { method: 'POST' }); onDone() } catch (e: any) { setErr(e.message) } }
  return (
    <div className="card">
      <h2>Proposed plan <span className="hcount">{plan.by === 'ai' ? 'by Claude' : 'by due date and priority'}</span></h2>
      <div className="body">
        <p>{plan.summary}</p>
        {plan.warnings.length > 0 && <div className="note warn">{plan.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>}
      </div>
      {days.filter((d) => plan.plan.some((p) => p.day === d.date)).map((d) => (
        <div className="body" key={d.date} style={{ paddingTop: 0 }}>
          <div className="meta">{dayName(d.date)}: {hm(plan.plan.filter((p) => p.day === d.date).reduce((n, p) => n + p.minutes, 0))}</div>
          <ul className="log">{plan.plan.filter((p) => p.day === d.date).map((p) => <li key={p.task_id}><span className="who">{p.title || 'Task'}</span> {hm(p.minutes)}{p.why ? `: ${p.why}` : ''}</li>)}</ul>
        </div>
      ))}
      {plan.not_this_week.length > 0 && (
        <div className="body" style={{ paddingTop: 0 }}>
          <div className="meta">Not this week</div>
          <ul className="log">{plan.not_this_week.map((p) => <li key={p.task_id}><span className="who">{p.title || 'Task'}</span> {p.why}</li>)}</ul>
        </div>
      )}
      <div className="body">
        <div className="toolbar">
          <button className="btn primary" onClick={() => act('apply')}>Use this plan</button>
          <button className="btn" onClick={() => act('dismiss')}>Dismiss</button>
        </div>
        {err && <div className="msg err">{err}</div>}
      </div>
    </div>
  )
}

export function Planner() {
  const calendarReady = !!useShell().microsoft?.connected
  const [week, setWeek] = useState<string | null>(null)
  const [data, setData] = useState<Week | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [openTask, setOpenTask] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setData(await api<Week>(`/planner${week ? `?week=${week}` : ''}`)); setErr('') } catch (e: any) { setErr(e.message) }
  }, [week])
  useEffect(() => { load() }, [load])

  const planIt = async () => {
    setBusy(true); setErr('')
    try { await api('/planner/plan', { method: 'POST', body: { week: data?.week } }); await load() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  if (!data) return <div className="card"><div className="emptyrow">{err || 'Reading ...'}</div></div>
  const total = data.days.filter((d) => !d.past).reduce((n, d) => n + d.free_minutes, 0)
  const planned = data.days.filter((d) => !d.past).reduce((n, d) => n + d.planned_minutes, 0)

  return (
    <>
      <div className="card">
        <h2>Week of {fmtDate(data.week)}</h2>
        <div className="body">
          <p>{hm(planned)} planned of {hm(total)} free{data.calendar ? ' after meetings' : ''} for the rest of the week.
            {' '}{data.calendar ? 'Free time comes from your Outlook calendar (busy times only).' : <>Free time is your working hours; <Link href="/settings">connect Microsoft 365</Link> to take meetings off.</>}
            {' '}Tasks without an estimate count as an hour.</p>
          <div className="toolbar">
            <button className="btn" onClick={() => setWeek(shift(data.week, -7))}>Previous week</button>
            <button className="btn" onClick={() => setWeek(null)}>This week</button>
            <button className="btn" onClick={() => setWeek(shift(data.week, 7))}>Next week</button>
            <span className="spacer" />
            <button className="btn primary" disabled={busy} onClick={planIt}>{busy ? 'Planning ...' : 'Plan my week'}</button>
          </div>
          {err && <div className="msg err">{err}</div>}
        </div>
      </div>

      {data.latest_plan && <Proposal plan={data.latest_plan} days={data.days} onDone={load} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
        {data.days.map((d) => (
          <div className="card" key={d.date} style={{ margin: 0, opacity: d.past ? 0.6 : 1 }}>
            <h2>{dayName(d.date)}{d.today ? ' (today)' : ''}</h2>
            <div className="body" style={{ paddingBottom: 0 }}>
              <p className="cap" style={{ margin: 0 }}>{hm(d.free_minutes)} free{d.meetings ? `, ${d.meetings} meeting${d.meetings === 1 ? '' : 's'}` : ''}; {hm(d.planned_minutes)} planned
                {d.over_by > 0 && <> <span className="pill Overdue">Over by {hm(d.over_by)}</span></>}</p>
            </div>
            {d.planned.length === 0 ? <div className="emptyrow">Nothing planned.</div>
              : d.planned.map((t) => <TaskRow key={t.id} t={t} days={data.days} onChange={load} onOpen={setOpenTask} calendar={calendarReady} />)}
            {d.due.length > 0 && <div className="body"><div className="meta">Due, not planned this day</div>
              <ul className="log">{d.due.map((t) => <li key={t.id}><button className="linkbtn" onClick={() => setOpenTask(t.id)}>{t.title}</button></li>)}</ul></div>}
            {d.coming_back.length > 0 && <div className="body"><div className="meta">Coming back</div>
              <ul className="log">{d.coming_back.map((c) => <li key={c.id}>{c.kind === 'task' ? <button className="linkbtn" onClick={() => setOpenTask(c.id)}>{c.title}</button>
                : <Link href="/projects">{c.title}</Link>}{c.kind === 'project' ? ' (project review)' : ''}</li>)}</ul></div>}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>To plan <span className="hcount">{data.to_plan.length}</span></h2>
        {data.to_plan.length === 0 ? <div className="emptyrow">Everything open is planned.</div>
          : data.to_plan.map((t) => <TaskRow key={t.id} t={t} days={data.days} onChange={load} onOpen={setOpenTask} calendar={calendarReady} />)}
      </div>
      {openTask && <TaskDetail taskId={openTask} onClose={() => { setOpenTask(null); load() }} onChanged={load} />}
    </>
  )
}
