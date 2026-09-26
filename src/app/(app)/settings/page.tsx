'use client'

import { useEffect, useState } from 'react'
import { api, raw } from '@/lib/client/todo'
import { Shell, useShell } from '@/components/Shell'
import { MsgLine, useLoad, type Msg } from '@/components/mail/common'

const REASONS: Record<string, string> = {
  wrong_account: 'That Microsoft account is not the one allowed to connect (AIMELIA_OWNER_EMAIL). Sign in with your own account.',
  invalid_state: 'That sign-in had expired or did not start in this browser. Start it again from here.',
  owner_not_configured: 'AIMELIA_OWNER_EMAIL is not set in Vercel, so no account can connect yet.',
  not_configured: 'MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET are not all set in Vercel.',
  could_not_confirm_account: 'Microsoft did not say which account signed in. Try again.',
  auth_failed: 'Microsoft sign-in failed. Check the client secret has not expired, then try again.',
  access_denied: 'The permissions were declined. Sign in again and accept them.',
}

export default function Settings() {
  const { refreshBrief } = useShell()
  const setup = useLoad(() => api('/setup'))
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const ms = p.get('ms')
    if (ms === 'connected') setMsg({ ok: true, text: 'Microsoft 365 is connected.' })
    if (ms === 'error') setMsg({ ok: false, text: REASONS[p.get('reason') || ''] || `Sign-in failed (${p.get('reason')}).` })
    if (ms) window.history.replaceState({}, '', '/settings')
  }, [])

  const disconnect = async () => {
    if (!confirm('Disconnect Microsoft 365? Email and calendar features stop until you connect again.')) return
    await raw('/auth/disconnect', { method: 'POST' }).catch(() => {})
    setMsg({ ok: true, text: 'Disconnected.' })
    setup.load()
    refreshBrief()
  }

  const s: any = setup.data
  const Row = ({ ok, label, fix }: { ok: boolean; label: string; fix: string }) => (
    <tr><td className="nowrap"><span className={`pill ${ok ? 'Done' : 'Atrisk'}`}>{ok ? 'Set' : 'Missing'}</span></td><td>{label}</td><td className="cap" style={{ margin: 0 }}>{ok ? '' : fix}</td></tr>
  )

  return (
    <Shell title="Settings" sub="The Microsoft 365 connection and what is configured on the server. Secret values are never shown here.">
      <div className="card"><h2>Microsoft 365</h2><div className="body">
        {!s ? <p className="cap">Reading ...</p> : s.microsoft_connected ? (
          <><p>Connected as <b>{s.microsoft_account}</b>. Aimelia can read your mail and calendar and write drafts and calendar events. It cannot send email.</p>
            <div className="toolbar"><a className="btn" href="/api/auth/login">Connect again</a><button className="btn danger" onClick={disconnect}>Disconnect</button></div></>
        ) : (
          <><p>Not connected. Connect with your own Microsoft 365 account; any other account is refused.</p>
            <div className="toolbar"><a className="btn primary" href="/api/auth/login">Connect Microsoft 365</a></div></>
        )}
        <MsgLine msg={msg} />
      </div></div>
      {s && (
        <div className="card"><h2>Server configuration</h2>
          <div className="tblwrap"><table><tbody>
            <Row ok={s.access_key} label="Access key (AIMELIA_ACCESS_KEY)" fix="Required. Set a long random string in Vercel." />
            <Row ok={s.encryption_key} label="Encryption key (ENCRYPTION_KEY)" fix="Required. At least 32 random characters." />
            <Row ok={s.owner_email} label="Owner account (AIMELIA_OWNER_EMAIL)" fix="Required to connect Microsoft 365." />
            <Row ok={s.cron_secret} label="Background timer (CRON_SECRET)" fix="Required for the agents and email jobs to run by themselves." />
            <Row ok={s.microsoft_app} label="Microsoft app (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET)" fix={`Register the app; its redirect URI is ${s.redirect_uri}`} />
            <Row ok={s.ai.anthropic || s.ai.openai} label="AI model (ANTHROPIC_API_KEY or OPENAI_API_KEY)" fix="Without one, answers are placeholders." />
            <Row ok={s.channels.teams || s.channels.phone} label="Morning push (TEAMS_WEBHOOK_URL or NTFY_URL)" fix="Optional." />
            <Row ok={s.sources.wscip} label="WSCIP lookups (WSCIP_EMAIL, WSCIP_PASSWORD)" fix="Optional. A read-only user in WSCIP." />
            <Row ok={s.sources.pcc} label="Payroll Command Center lookups (PCC_EMAIL, PCC_PASSWORD)" fix="Optional. A viewer user in Payroll Command Center." />
          </tbody></table></div>
        </div>
      )}
      <div className="card"><h2>Capture from your iPhone</h2><div className="body" style={{ fontSize: 13 }}>
        <p>Add Aimelia to your home screen: open it in Safari, Share, Add to Home Screen. The brain dump on Today takes dictation.</p>
        <p>For capture without opening the app, make a Shortcut: Dictate Text, then Get Contents of URL with URL <span className="mono">{s?.app_url || ''}/api/todo/capture</span>, method POST,
          header <span className="mono">X-Aimelia-Key</span> set to your access key, and a JSON body with <span className="mono">text</span> set to the dictated text. Put it on the Action Button.</p>
      </div></div>
    </Shell>
  )
}
