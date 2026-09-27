'use client'

/**
 * The app frame: white brand band with the coral rule, navy header, grouped sidebar.
 * Shows the sign-in screen until there is an Aimelia session. Every page but /chat carries the Ask Aimelia button.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, raw, SIGNED_OUT, type Briefing } from '@/lib/client/todo'
import { ChatLauncher } from '@/components/chat/Chat'

type Nav = { href: string; label: string; count?: (b: Briefing) => number }
const GROUPS: [string, Nav[]][] = [
  ['My work', [
    { href: '/chat', label: 'Ask Aimelia' },
    { href: '/today', label: 'Today', count: (b) => b.questions.length + b.actions.length + b.follow_ups.length },
    { href: '/tasks', label: 'All tasks' },
    { href: '/import', label: 'Import tasks' },
    { href: '/routines', label: 'Routines' },
  ]],
  // Hidden while Microsoft 365 is paused (not set up yet).
  ['Email and meetings', [
    { href: '/email', label: 'Email triage' },
    { href: '/calendar', label: 'Calendar and briefs' },
    { href: '/drafting', label: 'Smart drafting' },
    { href: '/prep', label: 'Meeting prep' },
  ]],
  ['Knowledge', [
    { href: '/memory', label: 'What Aimelia knows', count: (b) => b.memory_questions ?? 0 },
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

type Microsoft = { configured: boolean; connected: boolean; account: string | null }
type Ctx = { brief: Briefing | null; refreshBrief: () => void; microsoft: Microsoft | null }
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
  const [needsSetup, setNeedsSetup] = useState(false)
  const [brief, setBrief] = useState<Briefing | null>(null)
  const [microsoft, setMicrosoft] = useState<Ctx['microsoft']>(null)
  const [menu, setMenu] = useState(false)
  const path = usePathname()

  const check = useCallback(async () => {
    try {
      const s = await raw<{ signed_in: boolean; needs_setup: boolean }>('/session')
      setSignedIn(s.signed_in)
      setNeedsSetup(s.needs_setup)
    } catch {
      setSignedIn(false)
    }
  }, [])

  const refreshBrief = useCallback(() => {
    api<Briefing>('/briefing').then(setBrief).catch(() => {})
    raw('/auth/status').then(setMicrosoft).catch(() => setMicrosoft({ configured: false, connected: false, account: null }))
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
      {signedIn === null ? null : !signedIn ? <SignIn needsSetup={needsSetup} onDone={check} /> : (
        <ShellContext.Provider value={{ brief, refreshBrief, microsoft }}>
          <div className="app">
            <nav className={`sidenav ${menu ? 'open' : ''}`} aria-label="Sections">
              {GROUPS.filter(([group]) => group !== 'Email and meetings' || microsoft?.configured !== false).map(([group, items]) => (
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
                {microsoft === null ? 'Checking Microsoft 365 ...' : !microsoft.configured ? <Link href="/settings" style={{ padding: 0, border: 0 }}>Microsoft 365 paused</Link>
                  : microsoft.connected ? `Microsoft 365: ${microsoft.account}` : <Link href="/settings" style={{ padding: 0, border: 0 }}>Microsoft 365 not connected</Link>}
              </div>
            </nav>
            <main className="content">{children}</main>
            {path !== '/chat' && <ChatLauncher />}
          </div>
        </ShellContext.Provider>
      )}
    </>
  )
}

function SignIn({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v })

  const submit = async () => {
    setErr('')
    if (needsSetup && f.password !== f.confirm) return setErr('The two passwords do not match.')
    setBusy(true)
    try {
      if (needsSetup) await raw('/setup', { method: 'POST', body: { name: f.name, email: f.email, password: f.password } })
      else await raw('/session', { method: 'POST', body: { email: f.email, password: f.password } })
      onDone()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && submit()
  const ready = needsSetup ? f.name && f.email && f.password.length >= 10 && f.confirm : f.email && f.password

  return (
    <div className="signin">
      <h2>{needsSetup ? 'Welcome to Aimelia' : 'Sign in to Aimelia'}</h2>
      <p className="sub">{needsSetup
        ? 'This is a new install. Create your login: it becomes the owner account, and sign-up then closes.'
        : 'This browser stays signed in for 30 days.'}</p>
      {needsSetup && (
        <label className="fld"><span>Your name</span>
          <input autoFocus autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} onKeyDown={enter} /></label>
      )}
      <label className="fld"><span>Email</span>
        <input type="email" autoFocus={!needsSetup} autoComplete="username" value={f.email} onChange={(e) => set('email', e.target.value)} onKeyDown={enter}
          placeholder={needsSetup ? 'you@williamsstanley.co' : ''} /></label>
      <label className="fld"><span>{needsSetup ? 'Choose a password (at least 10 characters)' : 'Password'}</span>
        <input type="password" autoComplete={needsSetup ? 'new-password' : 'current-password'} value={f.password} onChange={(e) => set('password', e.target.value)} onKeyDown={enter} /></label>
      {needsSetup && (
        <label className="fld"><span>Type it again</span>
          <input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => set('confirm', e.target.value)} onKeyDown={enter} /></label>
      )}
      <button className="btn primary" style={{ width: '100%' }} disabled={!ready || busy} onClick={submit}>
        {busy ? 'One moment ...' : needsSetup ? 'Create my login' : 'Sign in'}
      </button>
      <div className={`msg ${err ? 'err' : ''}`}>{err}</div>
    </div>
  )
}
