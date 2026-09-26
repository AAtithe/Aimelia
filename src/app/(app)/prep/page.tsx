'use client'

import { useState } from 'react'
import { mail } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { BriefText, MsgLine, NotConnected, useLoad, type Msg } from '@/components/mail/common'

export default function MeetingPrep() {
  const guide = useLoad(() => mail('/prep/guidelines'))
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const [err, setErr] = useState('')
  const [run, setRun] = useState<any>(null)
  const [test, setTest] = useState({ subject: '', start_time: '', attendees: '', location: '' })
  const [testResult, setTestResult] = useState<any>(null)

  const prepAll = async (force: boolean) => {
    setBusy('all'); setMsg(null); setErr('')
    try { const r = await mail(`/prep/next24h${force ? '?force=true' : ''}`, { method: 'POST' }); setRun(r); setMsg({ ok: r.success, text: r.message }) }
    catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }
  const tryIt = async () => {
    setBusy('test'); setTestResult(null); setMsg(null)
    try {
      setTestResult(await mail('/prep/test', { method: 'POST', body: { subject: test.subject, start_time: test.start_time || undefined, location: test.location,
        attendees: test.attendees.split(',').map((s) => s.trim()).filter(Boolean), style: 'prep' } }))
    } catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy('') }
  }

  const sections = (guide.data as any)?.brief_sections || {}
  return (
    <Shell title="Meeting prep" sub="Prep you like a star: six sections, under 400 words, from the invite and recent emails with the people in it. Runs by itself at 06:00 and 18:00.">
      <NotConnected error={err} />
      <div className="grid2">
        <div className="card">
          <h2>The next 24 hours</h2>
          <div className="body">
            <ol style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>{Object.entries(sections).map(([k, v]) => <li key={k}><b>{k.replace(/^\d_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</b>: {String(v)}</li>)}</ol>
            <div className="toolbar">
              <button className="btn primary" disabled={!!busy} onClick={() => prepAll(false)}>{busy === 'all' ? 'Preparing ...' : 'Prepare my meetings'}</button>
              <button className="btn" disabled={!!busy} onClick={() => prepAll(true)}>Prepare them all again</button>
            </div>
            <MsgLine msg={msg} />
            {run?.errors?.length > 0 && <div className="note bad">{run.errors.map((x: any) => `${x.meeting}: ${x.error}`).join('\n')}</div>}
            <p className="cap">Briefs appear on Calendar and briefs. Your calendar events are never changed.</p>
          </div>
        </div>
        <div className="card">
          <h2>Try it on a made-up meeting</h2>
          <div className="body">
            <label className="fld"><span>Meeting</span><input value={test.subject} onChange={(e) => setTest({ ...test, subject: e.target.value })} placeholder="Bentleys Q3 review" /></label>
            <div className="row2">
              <label className="fld"><span>When</span><input type="datetime-local" value={test.start_time} onChange={(e) => setTest({ ...test, start_time: e.target.value })} /></label>
              <label className="fld"><span>Where</span><input value={test.location} onChange={(e) => setTest({ ...test, location: e.target.value })} /></label>
            </div>
            <label className="fld"><span>Attendees, comma-separated emails</span><input value={test.attendees} onChange={(e) => setTest({ ...test, attendees: e.target.value })} /></label>
            <button className="btn" disabled={!test.subject.trim() || !!busy} onClick={tryIt}>{busy === 'test' ? 'Writing ...' : 'Write a test brief'}</button>
          </div>
        </div>
      </div>
      {run?.prepared_meetings?.map((m: any) => (
        <div className="card" key={m.event_id}><h2>{m.subject} <span className="hcount">{m.word_count} words</span></h2><div className="body"><BriefText text={m.brief} /></div></div>
      ))}
      {testResult && (
        <div className="card"><h2>Test brief <span className="hcount">{testResult.word_count} words</span></h2>
          <div className="body"><p className="cap">{testResult.meets_requirements ? 'Within the 400-word limit.' : 'Over the 400-word limit.'}</p><BriefText text={testResult.brief_content} /></div></div>
      )}
    </Shell>
  )
}
