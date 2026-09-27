'use client'

import Link from 'next/link'
import { useState } from 'react'
import { mail } from '@/lib/client/todo'
import { Shell, useShell } from '@/components/Shell'
import { londonTime, MsgLine, useLoad, type Msg } from '@/components/mail/common'

export default function Automation() {
  const { data, load } = useLoad(() => mail<{ jobs: any[]; logs: any[] }>('/jobs'))
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const paused = useShell().microsoft?.configured === false

  const patch = async (id: string, b: unknown) => { await mail(`/jobs/${id}`, { method: 'PATCH', body: b }).catch((e) => setMsg({ ok: false, text: e.message })); load() }
  const runNow = async (id: string) => {
    setBusy(id); setMsg(null)
    try { await mail(`/jobs/${id}/run`, { method: 'POST' }); setMsg({ ok: true, text: 'Done.' }); load() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy('') }
  }

  return (
    <Shell title="Automation" sub="What Aimelia does by itself, on a timer that checks every 10 minutes. Nothing is ever sent from your mailbox.">
      <div className="note">The agent team also works its queue in the background, and the morning push goes to Teams or your phone at the time set in <Link href="/team">Agent team</Link>. Email jobs run only while Microsoft 365 is connected.</div>
      {paused && <div className="note info"><b>The email jobs are paused</b> until Microsoft 365 is set up. The agent team, routines and the morning push run as normal.</div>}
      <div className="card"><h2>Jobs</h2>
        {!data ? <div className="emptyrow">Reading ...</div> : data.jobs.map((j) => (
          <div className="agent" key={j.id}>
            <div className="main">
              <div className="nm">{j.name}{!j.enabled && <span className="pill Parked" style={{ marginLeft: 8 }}>Off</span>}</div>
              <div className="ds">{j.description}</div>
              <div className="md">{j.schedule}. {j.last_run_at ? `Last ran ${londonTime(j.last_run_at)}: ${summarise(j.last_result)}` : 'Not run yet.'}</div>
              {j.id === 'triage' && (
                <label className="chk" style={{ marginTop: 6 }}><input type="checkbox" checked={!!j.options.auto_draft} onChange={(e) => patch(j.id, { auto_draft: e.target.checked })} />
                  Also draft replies to urgent emails (drafts only, in Outlook)</label>
              )}
            </div>
            <div className="ctl">
              <button className="btn sm" onClick={() => patch(j.id, { enabled: !j.enabled })}>{j.enabled ? 'Turn off' : 'Turn on'}</button>
              <button className="btn sm" disabled={!!busy} onClick={() => runNow(j.id)}>{busy === j.id ? 'Running ...' : 'Run now'}</button>
            </div>
          </div>))}
      </div>
      <MsgLine msg={msg} />
      <div className="card"><h2>Recent activity <span className="hcount">{data?.logs.length || ''}</span></h2>
        {!data?.logs.length ? <div className="emptyrow">Nothing has run yet.</div> : (
          <div className="tblwrap"><table><thead><tr><th className="nowrap">When</th><th>Job</th><th>What happened</th></tr></thead>
            <tbody>{data.logs.map((l, i) => (
              <tr key={i}><td className="nowrap">{londonTime(l.created_at)}</td><td className="nowrap">{l.job}</td>
                <td>{l.level !== 'info' && <span className={`pill ${l.level === 'error' ? 'Overdue' : 'Atrisk'}`} style={{ marginRight: 6 }}>{l.level === 'error' ? 'Failed' : 'Check'}</span>}{l.message}</td></tr>))}</tbody></table></div>
        )}
      </div>
    </Shell>
  )
}

function summarise(r: any) {
  if (!r) return 'no result'
  if ('fetched' in r) return `fetched ${r.fetched}, sorted ${r.triaged} new${r.drafted ? `, drafted ${r.drafted}` : ''}`
  if ('total_meetings' in r) return `prepared ${r.meetings_prepared} of ${r.total_meetings} meetings`
  return JSON.stringify(r)
}
