'use client'

import { useCallback, useEffect, useState } from 'react'

/** London time, house format: 26 Sept 2026 14:30. */
export function londonTime(v: string | null | undefined, withDate = true) {
  if (!v) return ''
  // Graph times arrive as London wall clock without a zone ("2026-09-28T10:00:00.0000000"); stored ones are ISO instants.
  const wall = /[zZ]|[+-]\d\d:\d\d$/.test(v) ? null : v.slice(0, 16)
  const d = wall ? new Date(`${wall}:00Z`) : new Date(v)
  const tz = wall ? 'UTC' : 'Europe/London'
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })
  if (!withDate) return time
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).replace('Sep ', 'Sept ')
  return `${date} ${time}`
}

export function minutesUntil(v?: string) {
  if (!v) return null
  const wall = !/[zZ]|[+-]\d\d:\d\d$/.test(v)
  const start = wall ? new Date(new Date(`${v.slice(0, 16)}:00`).getTime()) : new Date(v)
  return Math.round((start.getTime() - Date.now()) / 60000)
}

/** Briefs are plain text. Rendered with React, never as HTML, so model output cannot inject markup. */
export function BriefText({ text }: { text: string }) {
  const lines = (text || '').split('\n')
  return (
    <div className="briefbody">
      {lines.map((line, i) => {
        const t = line.trim()
        const heading = /^(\d+\.\s*)?[A-Z][A-Z &/-]{2,}:?$/.test(t) || /^#{1,3}\s/.test(t)
        return heading ? <span key={i} className="h">{t.replace(/^#{1,3}\s/, '')}</span> : <span key={i}>{line}{'\n'}</span>
      })}
    </div>
  )
}

export function UrgencyPill({ u }: { u: number }) {
  const [cls, label] = u >= 5 ? ['Overdue', 'Critical'] : u >= 4 ? ['Atrisk', 'High'] : u >= 3 ? ['Unscheduled', 'Medium'] : ['Parked', u >= 2 ? 'Low' : 'Very low']
  return <span className={`pill ${cls}`}>{label} {u}/5</span>
}

export type Msg = { ok: boolean; text: string } | null
export const MsgLine = ({ msg }: { msg: Msg }) => <div className={`msg ${msg ? (msg.ok ? 'ok' : 'err') : ''}`}>{msg?.text}</div>

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setData(await fn()); setError('') } catch (e: any) { setError(e.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { load() }, [load])
  return { data, error, load, setData }
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function NotConnected({ error }: { error: string }) {
  if (!/Microsoft 365/.test(error)) return error ? <div className="note bad">{error}</div> : null
  return <div className="note warn"><b>Microsoft 365 is not connected.</b> Connect it in <a href="/settings">Settings</a> to read mail and your calendar.</div>
}
