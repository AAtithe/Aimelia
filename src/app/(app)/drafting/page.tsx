'use client'

import { useState } from 'react'
import { mail } from '@/lib/client/todo'
import { Shell, useShell } from '@/components/Shell'
import { MsgLine, useLoad, type Msg, MicrosoftPaused } from '@/components/mail/common'

type Result = { success: boolean; draft_content?: string; word_count?: number; meets_requirements?: boolean; sensitive_topics?: string[]; draft_link?: string | null; message?: string }

export default function SmartDrafting() {
  const emails = useLoad(() => mail<{ triaged_emails: any[] }>('/emails'))
  const guide = useLoad(() => mail('/draft/guidelines'))
  const [emailId, setEmailId] = useState('')
  const [summary, setSummary] = useState('')
  const [test, setTest] = useState({ subject: '', sender: '', body: '', thread_summary: '' })
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [msg, setMsg] = useState<Msg>(null)

  const go = async (label: string, path: string, b: unknown) => {
    setBusy(label)
    setMsg(null)
    setResult(null)
    try { const r = await mail<Result>(path, { method: 'POST', body: b }); setResult(r); if (r.message) setMsg({ ok: true, text: r.message }) }
    catch (e: any) { setMsg({ ok: false, text: e.message }) } finally { setBusy('') }
  }

  const list = emails.data?.triaged_emails || []
  const paused = useShell().microsoft?.configured === false
  if (paused) return <Shell title="Smart drafting" sub="Paused until Microsoft 365 is set up."><MicrosoftPaused /></Shell>

  return (
    <Shell title="Smart drafting" sub="Replies in your voice: UK English, decisive, 120 to 180 words. Drafts go to Outlook in the same thread, tagged Drafted by Aimelia, and are never sent.">
      <div className="grid2">
        <div className="card">
          <h2>Reply to an email</h2>
          <div className="body">
            <label className="fld"><span>Email</span>
              <select value={emailId} onChange={(e) => setEmailId(e.target.value)}>
                <option value="">{list.length ? 'Choose a recent email' : 'No sorted emails yet: check for mail in Email triage'}</option>
                {list.map((e) => <option key={e.id} value={e.id}>{e.subject || '(no subject)'}: {e.from_name || e.from}</option>)}
              </select>
            </label>
            <label className="fld"><span>What the thread is about (optional; Aimelia reads it if you leave this blank)</span>
              <textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} /></label>
            <div className="toolbar">
              <button className="btn primary" disabled={!emailId || !!busy} onClick={() => go('reply', '/draft/smart-reply', { email_id: emailId, thread_summary: summary })}>{busy === 'reply' ? 'Drafting ...' : 'Draft the reply'}</button>
              <button className="btn" disabled={!emailId || !!busy} onClick={() => go('auto', '/draft/auto-process', { email_id: emailId })}>{busy === 'auto' ? 'Reading ...' : 'Read the thread, then draft'}</button>
            </div>
          </div>
        </div>
        <div className="card">
          <h2>Try a draft without an email</h2>
          <div className="body">
            <div className="row2">
              <label className="fld"><span>Subject</span><input value={test.subject} onChange={(e) => setTest({ ...test, subject: e.target.value })} /></label>
              <label className="fld"><span>From</span><input value={test.sender} onChange={(e) => setTest({ ...test, sender: e.target.value })} placeholder="gm@venue.co.uk" /></label>
            </div>
            <label className="fld"><span>Their email</span><textarea rows={4} value={test.body} onChange={(e) => setTest({ ...test, body: e.target.value })} /></label>
            <label className="fld"><span>Background (optional)</span><input value={test.thread_summary} onChange={(e) => setTest({ ...test, thread_summary: e.target.value })} /></label>
            <button className="btn" disabled={!test.body.trim() || !!busy} onClick={() => go('test', '/draft/test', { ...test, subject: test.subject || 'Test Email', sender: test.sender || 'client@example.com' })}>{busy === 'test' ? 'Writing ...' : 'Write a test draft'}</button>
          </div>
        </div>
      </div>
      <MsgLine msg={msg} />
      {result?.draft_content && (
        <div className="card">
          <h2>The draft <span className="hcount">{result.word_count} words</span></h2>
          <div className="body">
            <p className="cap">{result.meets_requirements ? 'Within 120 to 180 words.' : 'Outside 120 to 180 words: worth a trim or a line more.'}{result.draft_link && <> <a href={result.draft_link} target="_blank" rel="noreferrer">Open it in Outlook</a>.</>}</p>
            {!!result.sensitive_topics?.length && <div className="note warn"><b>Check before sending:</b> it mentions {result.sensitive_topics.join(', ')}.</div>}
            <div className="briefbody">{result.draft_content}</div>
          </div>
        </div>
      )}
      {guide.data && (
        <div className="card"><h2>House rules for drafts</h2><div className="body"><table><tbody>
          {Object.entries(guide.data).filter(([k]) => k !== 'examples' && k !== 'sensitive_words').map(([k, v]) => <tr key={k}><td className="nowrap" style={{ color: 'var(--muted)' }}>{k.replace(/_/g, ' ')}</td><td>{String(v)}</td></tr>)}
          <tr><td className="nowrap" style={{ color: 'var(--muted)' }}>flagged words</td><td>{(guide.data as any).sensitive_words.join(', ')}</td></tr>
        </tbody></table></div></div>
      )}
    </Shell>
  )
}
