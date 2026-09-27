'use client'

import { useEffect, useState } from 'react'
import { raw } from '@/lib/client/todo'
import { Shell, useShell } from '@/components/Shell'
import { londonTime, MsgLine, useLoad, type Msg } from '@/components/mail/common'

const REASONS: Record<string, string> = {
  wrong_account: 'That Microsoft account does not match your Aimelia login. Sign in to Microsoft with the same email.',
  invalid_state: 'That sign-in had expired or started in another browser. Start it again from here.',
  not_configured: 'The Microsoft app details below are not complete yet.',
  could_not_confirm_account: 'Microsoft did not say which account signed in. Try again.',
  auth_failed: 'Microsoft sign-in failed. Check the client secret has not expired and the redirect address matches exactly.',
  access_denied: 'The permissions were declined. Sign in again and accept them.',
}

type Field = { label: string; secret: boolean; group: string; set: boolean; source: 'vercel' | 'aimelia' | null; value: string | null }
type Settings = { values: Record<string, Field>; microsoft: { configured: boolean; connected: boolean; account: string | null; redirect_uri: string }
  ai: Record<string, boolean>; channels: Record<string, boolean>; sources: Record<string, boolean>; app_url: string }

export default function SettingsPage() {
  const { refreshBrief } = useShell()
  const acct = useLoad(() => raw<any>('/account'))
  const conf = useLoad(() => raw<Settings>('/account/settings'))
  const [msMsg, setMsMsg] = useState<Msg>(null)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const ms = p.get('ms')
    if (ms === 'connected') setMsMsg({ ok: true, text: 'Microsoft 365 is connected.' })
    if (ms === 'error') setMsMsg({ ok: false, text: REASONS[p.get('reason') || ''] || `Sign-in failed (${p.get('reason')}).` })
    if (ms) window.history.replaceState({}, '', '/settings')
  }, [])

  const saved = () => { conf.load(); refreshBrief() }
  const s = conf.data
  const ms = s?.microsoft

  return (
    <Shell title="Settings" sub="Your login, and everything Aimelia connects to. Keys and passwords you enter here are stored encrypted and never shown again.">
      <AccountCard data={acct.data} reload={acct.load} />

      {s && (
        <ConfigCard title="AI" intro="The agents and email features need one AI key. Without one they give placeholder answers. Claude (Anthropic) is the default; OpenAI works too."
          fields={['anthropic_api_key', 'openai_api_key']} values={s.values} onSaved={saved}
          status={s.ai.anthropic || s.ai.openai ? <span className="pill Done">Key saved</span> : <span className="pill Atrisk">No key yet</span>} />
      )}

      {s && ms && (
        <div className="card">
          <h2>Microsoft 365 <span className="hcount">{ms.connected ? 'Connected' : ms.configured ? 'Ready to connect' : 'Paused'}</span></h2>
          <div className="body">
            {ms.connected ? (
              <p>Connected as <b>{ms.account}</b>. Aimelia reads mail, calendar and To Do, writes drafts and focus-time events, and never sends email.
                If Import tasks says To Do access is missing, choose Connect again and accept the Tasks permission.</p>
            ) : ms.configured ? (
              <p>The Microsoft app is set up. Connect with the same email you use for Aimelia; any other account is refused.</p>
            ) : (
              <p><b>Paused.</b> Email, calendar, reply drafts and meeting prep switch on once a developer fills in the three Microsoft app details below
                (full steps in docs/MICROSOFT-SETUP.md). Everything else works now.</p>
            )}
            <div className="toolbar">
              {ms.configured && <a className={`btn ${ms.connected ? '' : 'primary'}`} href="/api/auth/login">{ms.connected ? 'Connect again' : 'Connect Microsoft 365'}</a>}
              {ms.connected && <button className="btn danger" onClick={async () => {
                if (!confirm('Disconnect Microsoft 365? Email and calendar features stop until you connect again.')) return
                await raw('/auth/disconnect', { method: 'POST' }).catch(() => {}); saved()
              }}>Disconnect</button>}
            </div>
            <MsgLine msg={msMsg} />
          </div>
          <ConfigFields fields={['ms_tenant_id', 'ms_client_id', 'ms_client_secret']} values={s.values} onSaved={saved}
            intro={<>For the developer: register the app in Microsoft Entra with the redirect address <span className="mono">{ms.redirect_uri}</span> and the delegated
              permissions User.Read, Mail.ReadWrite, Calendars.ReadWrite, Tasks.Read and offline_access, then enter its details here.</>} />
        </div>
      )}

      {s && (
        <ConfigCard title="Morning push" intro="Where the morning brief goes: a Teams channel, your phone through the ntfy app, or both. Never email. Set the time in Agent team."
          fields={['teams_webhook_url', 'ntfy_url', 'ntfy_token']} values={s.values} onSaved={saved}
          status={s.channels.teams || s.channels.phone ? <span className="pill Done">Set up</span> : <span className="pill Parked">Optional</span>} />
      )}

      {s && (
        <ConfigCard title="WSCIP and Payroll Command Center" intro="Optional. A read-only user in each lets the agents look things up instead of asking you. Only a fixed list of reads is ever made."
          fields={['wscip_email', 'wscip_password', 'pcc_email', 'pcc_password']} values={s.values} onSaved={saved}
          status={s.sources.wscip || s.sources.pcc ? <span className="pill Done">Connected</span> : <span className="pill Parked">Optional</span>} />
      )}

      {s && (
        <ConfigCard title="Fireflies" intro="Optional. With your Fireflies API key (Fireflies: Settings, Developer settings), Import tasks lists your recent meetings and turns their action items into tasks. Read only."
          fields={['fireflies_api_key']} values={s.values} onSaved={saved}
          status={s.values.fireflies_api_key?.set ? <span className="pill Done">Connected</span> : <span className="pill Parked">Optional</span>} />
      )}

      <CaptureCard data={acct.data} reload={acct.load} appUrl={s?.app_url || ''} />
    </Shell>
  )
}

function AccountCard({ data, reload }: { data: any; reload: () => void }) {
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [msg, setMsg] = useState<Msg>(null)
  const change = async () => {
    setMsg(null)
    if (pw.next !== pw.confirm) return setMsg({ ok: false, text: 'The two new passwords do not match.' })
    try {
      await raw('/account/password', { method: 'POST', body: { current: pw.current, next: pw.next } })
      setPw({ current: '', next: '', confirm: '' })
      setMsg({ ok: true, text: 'Password changed. Other browsers have been signed out.' })
      reload()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const others = (data?.sessions || []).filter((x: any) => !x.this_browser)
  return (
    <div className="card">
      <h2>Your login</h2>
      <div className="body">
        {data ? <p>Signed in as <b>{data.user.name}</b>, {data.user.email}.</p> : <p className="cap">Reading ...</p>}
        <div className="row2">
          <label className="fld"><span>Current password</span><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label className="fld"><span>New password (10 or more characters)</span><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
          <label className="fld"><span>New password again</span><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
        </div>
        <button className="btn" disabled={!pw.current || pw.next.length < 10} onClick={change}>Change password</button>
        <MsgLine msg={msg} />
      </div>
      {data && (
        <div className="body">
          <p className="cap" style={{ marginBottom: 6 }}>Signed in on {data.sessions.length} device{data.sessions.length === 1 ? '' : 's'}.</p>
          <ul className="log">{data.sessions.map((x: any) => (
            <li key={x.id}><span className="who">{x.this_browser ? 'This browser' : describe(x.device)}</span><span className="when">last used {londonTime(x.last_seen)}</span></li>))}</ul>
          {others.length > 0 && <div className="toolbar"><button className="btn danger" onClick={async () => { await raw('/account/sign-out-others', { method: 'POST' }); reload() }}>Sign out the other {others.length}</button></div>}
        </div>
      )}
    </div>
  )
}

const describe = (ua: string) => /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : 'Another device'

function ConfigCard({ title, intro, fields, values, onSaved, status }: { title: string; intro: string; fields: string[]; values: Record<string, Field>; onSaved: () => void; status?: React.ReactNode }) {
  return (
    <div className="card">
      <h2>{title} {status && <span className="hcount" style={{ opacity: 1 }}>{status}</span>}</h2>
      <ConfigFields fields={fields} values={values} onSaved={onSaved} intro={intro} />
    </div>
  )
}

function ConfigFields({ fields, values, onSaved, intro }: { fields: string[]; values: Record<string, Field>; onSaved: () => void; intro: React.ReactNode }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<Msg>(null)
  const changed = Object.entries(draft).filter(([, v]) => v.trim() !== '')
  const save = async (patch: Record<string, string | null>, ok: string) => {
    setMsg(null)
    try { await raw('/account/settings', { method: 'PATCH', body: patch }); setDraft({}); setMsg({ ok: true, text: ok }); onSaved() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <div className="body">
      <p className="cap">{intro}</p>
      <div className="row2">
        {fields.map((k) => {
          const f = values[k]
          if (!f) return null
          const hint = f.source === 'vercel' ? 'Set in Vercel' : f.set ? (f.secret ? 'Saved (hidden). Type to replace.' : '') : ''
          return (
            <label className="fld" key={k}><span>{f.label}{f.set && <span className="pill Done" style={{ marginLeft: 6 }}>Set</span>}</span>
              <input type={f.secret ? 'password' : 'text'} autoComplete="off" disabled={f.source === 'vercel'} value={draft[k] ?? (f.secret ? '' : f.value || '')}
                placeholder={hint} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
              {f.set && f.source === 'aimelia' && <button className="linkbtn" style={{ marginTop: 3 }} onClick={(e) => { e.preventDefault(); save({ [k]: null }, 'Removed.') }}>Remove</button>}
            </label>
          )
        })}
      </div>
      <button className="btn primary" disabled={!changed.length} onClick={() => save(Object.fromEntries(changed), 'Saved.')}>Save</button>
      <MsgLine msg={msg} />
    </div>
  )
}

function CaptureCard({ data, reload, appUrl }: { data: any; reload: () => void; appUrl: string }) {
  const [fresh, setFresh] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const make = async () => {
    try { const r = await raw('/account/keys', { method: 'POST', body: { name: 'iPhone shortcut' } }); setFresh(r.key); reload() }
    catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <div className="card">
      <h2>Capture from your iPhone</h2>
      <div className="body" style={{ fontSize: 13 }}>
        <p>Add Aimelia to your home screen: open it in Safari, Share, Add to Home Screen. The brain dump on Today takes dictation.</p>
        <p>To capture without opening the app, make a capture key, then a Shortcut: Dictate Text, then Get Contents of URL with address
          <span className="mono"> {appUrl}/api/todo/capture</span>, method POST, header <span className="mono">X-Aimelia-Key</span> set to the key, and a JSON body with
          <span className="mono"> text</span> set to the dictated text.</p>
        {fresh && <div className="note warn"><b>Your capture key:</b> <span className="mono" style={{ userSelect: 'all' }}>{fresh}</span><br />Copy it into the Shortcut now; it is not shown again.</div>}
        <div className="toolbar"><button className="btn" onClick={make}>Make a capture key</button></div>
        {data?.keys?.length > 0 && (
          <ul className="log" style={{ marginTop: 10 }}>{data.keys.map((k: any) => (
            <li key={k.id}><span className="who">{k.name}</span><span className="when">{k.last_used_at ? `last used ${londonTime(k.last_used_at)}` : 'not used yet'}</span>
              <button className="linkbtn" style={{ marginLeft: 10 }} onClick={async () => { await raw(`/account/keys/${k.id}`, { method: 'DELETE' }); reload() }}>Revoke</button></li>))}</ul>
        )}
        <MsgLine msg={msg} />
      </div>
    </div>
  )
}
