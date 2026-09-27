import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// The shared house style is a stamped copy of AAtithe/house-style.
// house-check.js is that repository's house.js, copied beside it unchanged.
const require = createRequire(import.meta.url)
const house = require('../src/app/house-check.js') as { check: (css: string) => { version: string; css: string } }
const read = (f: string) => readFileSync(path.join(__dirname, '..', 'src', 'app', f), 'utf8')

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
// Every selector of every rule, media queries included.
const selectors = (css: string) =>
  [...stripComments(css).matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
const rootTokens = (css: string) =>
  [...stripComments(css).matchAll(/:root\s*\{([^}]*)\}/g)]
    .flatMap((m) => [...m[1].matchAll(/(--[\w-]+)\s*:/g)].map((t) => t[1]))

describe('house style', () => {
  const shared = house.check(read('ws-house.css'))
  const own = read('house.css')

  it('carries a stamped, unedited copy of the shared stylesheet', () => {
    expect(shared.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(shared.css).toContain('.card{')
    expect(() => house.check(read('ws-house.css').replace('--navy:#003359', '--navy:#003358'))).toThrow(/edited/)
  })

  it('is loaded before Aimelia\'s own rules', () => {
    const layout = readFileSync(path.join(__dirname, '..', 'src', 'app', 'layout.tsx'), 'utf8')
    const a = layout.indexOf("import './ws-house.css'"), b = layout.indexOf("import './house.css'")
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
  })

  it('leaves the tokens to the shared file', () => {
    const sharedTokens = new Set(rootTokens(shared.css))
    expect(sharedTokens.has('--navy')).toBe(true)
    expect(rootTokens(own).filter((t) => sharedTokens.has(t))).toEqual([])
  })

  it('does not restyle a shared component under .ws', () => {
    const sharedSel = new Set(selectors(shared.css))
    const scoped = selectors(own).filter((s) => s.startsWith('.ws ')).map((s) => s.slice(4))
    expect(scoped.filter((s) => sharedSel.has(s))).toEqual([])
    // The ones that matter most, named, so the list above cannot drift to empty.
    for (const s of ['.btn', '.card', '.card h2', '.kpis', '.kpi', 'th', 'td', 'table', '.pill', '.Done', '.note', '.tag',
      '.msg', '.cap', '.topbar', 'header', '.wrap', '.main-tab-btn', '.drawer', '.drawer-bg', '.dclose', 'select', '.toolbar', '.grid2']) {
      expect(sharedSel.has(s)).toBe(true)
      expect(scoped).not.toContain(s)
    }
  })
})
