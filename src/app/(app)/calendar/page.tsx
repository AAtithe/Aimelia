'use client'

import { useState } from 'react'
import { mail } from '@/lib/client/todo'
import { Shell } from '@/components/Shell'
import { BriefText, download, londonTime, minutesUntil, MsgLine, NotConnected, useLoad, type Msg } from '@/components/mail/common'

type Row = { event: any; brief: string | null; style?: string; generated_at?: string; recent_comms_count?: number; word_count?: number }

export default function CalendarBriefs() {
  const { data, error, load } = useLoad(() => mail<{ briefs: Row[] }>('/briefs/upcoming'))
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<Msg>(null)

  const prepareAll = async () => {
    setBusy('all')
    setMsg(null)
    try { const r = await mail('/prep/next24h', { method: 'POST' }); setMsg({ ok: r.success, text: r.message }); load() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy('') }
  }
  const prepare = async (id: string, style: 'prep' | 'brief') => {
    setBusy(id)
    setMsg(null)
    try { await mail(`/briefs/${encodeURIComponent(id)}?style=${style}`, { method: 'POST' }); load() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy('') }
  }

  const rows = data?.briefs || []
  return (
    <Shell title="Calendar and briefs" sub="The next seven days, in London time, with a brief for each meeting. Briefs are kept here; your calendar is never changed."
      actions={<><button className="btn ghost" onClick={load}>Refresh</button><button className="btn ghost" disabled={!!busy} onClick={prepareAll}>{busy === 'all' ? 'Preparing ...' : 'Prepare the next 24 hours'}</button></>}>
      <NotConnected error={error} />
      <MsgLine msg={msg} />
      {!data ? (!error && <p className="cap">Reading your calendar ...</p>) : rows.length === 0 ? <div className="note info"><b>No meetings in the next seven days.</b></div> : rows.map((r) => {
        const e = r.event
        const soon = minutesUntil(e.start?.dateTime)
        const people = (e.attendees || []).map((a: any) => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean)
        return (
          <div className="card" key={e.id}>
            <h2>{e.subject || 'Meeting'} <span className="hcount">{londonTime(e.start?.dateTime)} to {londonTime(e.end?.dateTime, false)}</span></h2>
            <div className="body">
              <div className="o" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {soon !== null && soon >= 0 && soon <= 30 && <span className="pill Atrisk">Starts in {soon} min</span>}
                {e.isAllDay && <span className="pill Parked">All day</span>}
                {e.location?.displayName && <span className="tag">{e.location.displayName}</span>}
                {e.isOnlineMeeting && e.onlineMeeting?.joinUrl && <a className="btn sm" href={e.onlineMeeting.joinUrl} target="_blank" rel="noreferrer">Join</a>}
                <span className="cap" style={{ margin: 0 }}>{people.length ? `${people.slice(0, 4).join(', ')}${people.length > 4 ? ` and ${people.length - 4} more` : ''}` : 'No other attendees'}</span>
              </div>
              {r.brief ? (
                <>
                  <p className="cap" style={{ marginTop: 10 }}>{r.style === 'prep' ? 'Full prep' : 'Brief'}, {r.word_count} words, from {r.recent_comms_count} recent email{r.recent_comms_count === 1 ? '' : 's'}. Prepared {londonTime(r.generated_at)}.</p>
                  <BriefText text={r.brief} />
                </>
              ) : <p className="cap" style={{ marginTop: 10 }}>No brief yet.</p>}
              <div className="toolbar">
                <button className="btn primary" disabled={!!busy} onClick={() => prepare(e.id, 'prep')}>{busy === e.id ? 'Preparing ...' : r.brief ? 'Prepare again' : 'Prepare me for this'}</button>
                <button className="btn" disabled={!!busy} onClick={() => prepare(e.id, 'brief')}>Short brief</button>
                {r.brief && <button className="btn" onClick={() => download(`${(e.subject || 'meeting').replace(/[^a-z0-9]+/gi, '_')}_brief.txt`, r.brief!)}>Download</button>}
              </div>
            </div>
          </div>
        )
      })}
    </Shell>
  )
}
