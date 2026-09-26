'use client'

/**
 * The app frame: white brand band with the coral rule, navy header, grouped sidebar.
 * Shows the sign-in screen until there is an Aimelia session.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, raw, SIGNED_OUT, type Briefing } from '@/lib/client/todo'

type Nav = { href: string; label: string; count?: (b: Briefing) => number }
const GROUPS: [string, Nav[]][] = [
  ['My work', [
    { href: '/today', label: 'Today', count: (b) => b.questions.length + b.actions.length + b.follow_ups.length },
    { href: '/tasks', label: 'All tasks' },
    { href: '/routines', label: 'Routines' },
  ]],
  ['Email and meetings', [
    { href: '/email', label: 'Email triage' },
    { href: '/calendar', label: 'Calendar and briefs' },
    { href: '/drafting', label: 'Smart drafting' },
    { href: '/prep', label: 'Meeting prep' },
  ]],
  ['Knowledge', [
    { href: '/knowledge', label: 'Knowledge base' },
    { href: '/workbench', label: 'AI workbench' },
  ]],
  ['Team and settings', [
    { href: '/team', label: 'Agent team' },
    { href: '/learning', label: 'Learning' },
    { href: '/automation', label: 'Automation' },
    { href: '/analytics', label: 'Analytics' },
    { href: '/settings', label: 'Settings' },
  ]],
]

type Ctx = { brief: Briefing | null; refreshBrief: () => void; microsoft: { connected: boolean; account: string | null } | null }
const ShellContext = createContext<Ctx>({ brief: null, refreshBrief: () => {}, microsoft: null })
export const useShell = () => useContext(ShellContext)

export function Shell({ title, sub, actions, children }: { title: string; sub: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <header>
        <div className="ttl"><h1>{title}</h1><div className="sub">{sub}</div></div>
        {actions && <div className="who">{actions}</div>}
      </header>
      <div className="wrap">{children}</div>
    </>
  )
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [configured, setConfigured] = useState(true)
  const [brief, setBrief] = useState<Briefing | null>(null)
  const [microsoft, setMicrosoft] = useState<Ctx['microsoft']>(null)
  const [menu, setMenu] = useState(false)
  const path = usePathname()

  const check = useCallback(async () => {
    try {
      const s = await raw<{ signed_in: boolean; configured: boolean }>('/session')
      setSignedIn(s.signed_in)
      setConfigured(s.configured)
    } catch {
      setSignedIn(false)
    }
  }, [])

  const refreshBrief = useCallback(() => {
    api<Briefing>('/briefing').then(setBrief).catch(() => {})
    raw('/auth/status').then(setMicrosoft).catch(() => setMicrosoft({ connected: false, account: null }))
  }, [])

  useEffect(() => { check() }, [check])
  useEffect(() => {
    const out = () => setSignedIn(false)
    window.addEventListener(SIGNED_OUT, out)
    return () => window.removeEventListener(SIGNED_OUT, out)
  }, [])
  useEffect(() => {
    if (!signedIn) return
    refreshBrief()
    const t = setInterval(refreshBrief, 60000)
    return () => clearInterval(t)
  }, [signedIn, refreshBrief])
  useEffect(() => setMenu(false), [path])

  const signOut = async () => {
    await raw('/session', { method: 'DELETE' }).catch(() => {})
    setSignedIn(false)
  }

  return (
    <>
      <div className="topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="wslogo" src="/assets/ws-logo.png" alt="Williams, Stanley &amp; Co." width={281} height={19} />
        <span className="topbar-app">Aimelia</span>
        {signedIn && (
          <>
            <button className="topbar-guide navbtn" onClick={() => setMenu(!menu)} aria-expanded={menu}>Menu</button>
            <button className="topbar-guide" style={{ marginLeft: menu ? 8 : undefined }} onClick={signOut}>Sign out</button>
          </>
        )}
      </div>
      {signedIn === null ? null : !signedIn ? <SignIn configured={configured} onDone={check} /> : (
        <ShellContext.Provider value={{ brief, refreshBrief, microsoft }}>
          <div className="app">
            <nav className={`sidenav ${menu ? 'open' : ''}`} aria-label="Sections">
              {GROUPS.map(([group, items]) => (
                <div key={group}>
                  <div className="grp">{group}</div>
                  {items.map((n) => {
                    const count = brief && n.count ? n.count(brief) : 0
                    return (
                      <Link key={n.href} href={n.href} className={path === n.href ? 'on' : ''}>
                        <span>{n.label}</span>{count > 0 && <span className="cnt">{count}</span>}
                      </Link>
                    )
                  })}
                </div>
              ))}
              <div className="connect">
                <span className={`dot ${microsoft?.connected ? 'on' : ''}`} />
                {microsoft === null ? 'Checking Microsoft 365 ...' : microsoft.connected ? `Microsoft 365: ${microsoft.account}` : <Link href="/settings" style={{ padding: 0, border: 0 }}>Microsoft 365 not connected</Link>}
              </div>
            </nav>
            <main className="content">{children}</main>
          </div>
        </ShellContext.Provider>
      )}
    </>
  )
}

function SignIn({ configured, onDone }: { configured: boolean; onDone: () => void }) {
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      await raw('/session', { method: 'POST', body: { key } })
      onDone()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="signin">
      <h2>Sign in to Aimelia</h2>
      <p className="sub">Enter the access key. This browser stays signed in for 30 days.</p>
      {!configured && <div className="note warn">The server is missing AIMELIA_ACCESS_KEY or ENCRYPTION_KEY. Set both in Vercel, then redeploy.</div>}
      <label className="fld"><span>Access key</span>
        <input type="password" autoFocus autoComplete="current-password" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key && submit()} />
      </label>
      <button className="btn primary" style={{ width: '100%' }} disabled={!key || busy} onClick={submit}>{busy ? 'Checking ...' : 'Sign in'}</button>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
    </div>
  )
}
