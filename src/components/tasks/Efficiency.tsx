'use client'

/**
 * The efficiency agent's part of Questions on Today: what it answered for Tom from what he said before (to check,
 * with Right and Not right, ask me), and the questions that keep coming back, each with a standing answer to keep.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, fmtDateTime, type Question } from '@/lib/client/todo'

type Recurring = { topic: string; standing_answer: string; question_ids: string[]; times: number }
type Eff = {
  enabled: boolean; time: string
  answered_for_you: (Question & { task_title: string; source: string | null })[]
  recurring: Recurring[]
  last_run: { at: string; trigger: string } | null
  this_week: { answered: number; merged: number } | null
}

function StandingItem({ r, onKept }: { r: Recurring; onKept: () => void }) {
  const [text, setText] = useState(r.standing_answer)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const keep = async () => {
    setBusy(true); setMsg(null)
    try {
      await api('/efficiency/standing', { method: 'POST', body: { topic: r.topic, answer: text } })
      setMsg({ ok: true, text: 'Kept. The team will use it and will not ask again.' })
      setTimeout(onKept, 1000)
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }
  return (
    <div className="item">
      <div className="o"><span className="tag">Asked {r.times} times</span></div>
      <div className="t">{r.topic}</div>
      <textarea className="inp" style={{ marginTop: 6 }} rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Standing answer: ${r.topic}`} />
      <div className="toolbar"><button className="btn primary" disabled={busy || !text.trim()} onClick={keep}>Keep as a standing answer</button></div>
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
    </div>
  )
}

function AnsweredItem({ q, onDone }: { q: Eff['answered_for_you'][number]; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const act = async (path: string, ok: string) => {
    setBusy(true); setMsg(null)
    try { await api(`/questions/${q.id}/${path}`, { method: 'POST' }); setMsg({ ok: true, text: ok }); setTimeout(onDone, 900) }
    catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }
  return (
    <div className="item">
      <div className="o"><span className="tag">{q.task_title}</span><span>Asked by {q.asked_by}</span>{q.created_at && <span>{fmtDateTime(q.created_at)}</span>}</div>
      <div className="t">{q.question}</div>
      <div className="meta"><b>Aimelia answered:</b> {q.answer}</div>
      {q.source && <div className="meta">From: {q.source}</div>}
      <div className="toolbar">
        <button className="btn" disabled={busy} onClick={() => act('confirm', 'Thanks. Noted as right.')}>Right</button>
        <button className="btn danger" disabled={busy} onClick={() => act('reopen', 'Asked again: it is in your questions now, and the task waits for your answer.')}>Not right, ask me</button>
      </div>
      <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>
    </div>
  )
}

export function EfficiencyPanel({ onChanged }: { onChanged: () => void }) {
  const [eff, setEff] = useState<Eff | null>(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => { try { setEff(await api<Eff>('/efficiency')) } catch (e: any) { setErr(e.message) } }, [])
  useEffect(() => { load() }, [load])
  const changed = () => { load(); onChanged() }
  const run = async () => {
    setRunning(true); setErr('')
    try { await api('/efficiency/run', { method: 'POST' }); changed() } catch (e: any) { setErr(e.message) } finally { setRunning(false) }
  }
  if (!eff) return err ? <div className="msg err">{err}</div> : null
  const saved = (eff.this_week?.answered || 0) + (eff.this_week?.merged || 0)
  return (
    <>
      <div className="effline">
        <span className="cap">
          Efficiency agent: {saved ? `this week it answered ${eff.this_week?.answered || 0} and joined ${eff.this_week?.merged || 0} repeat question${eff.this_week?.merged === 1 ? '' : 's'} for you.` : 'checks every question against what you have already said before it reaches you.'}
          {eff.last_run ? ` Last sweep ${fmtDateTime(eff.last_run.at)}.` : ''}
        </span>
        <button className="btn" disabled={running} onClick={run}>{running ? 'Checking ...' : 'Check my questions now'}</button>
      </div>
      {err && <div className="msg err">{err}</div>}
      {eff.answered_for_you.length > 0 && (
        <div className="card"><h2>Answered for you, to check <span className="hcount">{eff.answered_for_you.length}</span></h2>
          {eff.answered_for_you.map((q) => <AnsweredItem key={q.id} q={q} onDone={changed} />)}</div>
      )}
      {eff.recurring.length > 0 && (
        <div className="card"><h2>Questions that keep coming back <span className="hcount">{eff.recurring.length}</span></h2>
          <div className="body" style={{ paddingBottom: 0 }}><p className="cap" style={{ margin: 0 }}>Answer each once for good: keep the standing answer (edit it first if it needs it) and the team will use it instead of asking.</p></div>
          {eff.recurring.map((r) => <StandingItem key={r.topic} r={r} onKept={changed} />)}</div>
      )}
    </>
  )
}
