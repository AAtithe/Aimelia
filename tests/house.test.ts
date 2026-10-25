import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

// The logos are the house style's too: public/brand is a copy of house-style's
// brand/ (1.3.0), synced with --no-readme because Next serves the folder. An
// edit made here instead of in house-style fails this; after a deliberate sync
// of a new version, replace these fingerprints with the new files'.
const BRAND: Record<string, string> = {
  'ws-icon-256.png': 'a105a2dcdae91b1992af03c09220cf48b8e76bffbe33494f8242e3b70a19e13d',
  'ws-monogram-reversed.png': 'aa230762141da75e38efef349260eb1cb0d0cee495dfb31ec905bcec6f43874f',
  'ws-monogram-reversed.svg': 'd8cc5af1f48791dd9799764e10298108cf89d04265db0d44ffdd1e68d04e07c9',
  'ws-monogram.png': 'bc49defafb39663bfe5111c311b06232f83a5b0beacabc0e8c3ec7df30dd0357',
  'ws-monogram.svg': 'e22724aa6019373ef77fd9e257e662d15cad10cf81244ef394dbdfe6f51d2d8b',
  'ws-wordmark-reversed.png': '89eb972ff3a1a17b3c2a9deacad07ff14433db9bec7eb561252b6f73f3cdcbb5',
  'ws-wordmark-reversed.svg': 'ffa4effe0dfaca0645e12054b3b8c875b5203c8098ab1382392737982aa541f3',
  'ws-wordmark.png': '72d7c4c74067a3cc7e45e78525527f93cd1f44bce2f75e8f05ce24faac9ea2c8',
  'ws-wordmark.svg': '8d178bb9c46b51ad129a3cfe1a49a111ca0a6820113d4706317c2684a183b3dd',
}
const root = path.join(__dirname, '..')

describe('logos', () => {
  it('public/brand is house-style\'s logos, unedited', () => {
    const dir = path.join(root, 'public', 'brand')
    expect(readdirSync(dir).sort()).toEqual(Object.keys(BRAND).sort())
    for (const [f, want] of Object.entries(BRAND)) {
      const got = createHash('sha256').update(readFileSync(path.join(dir, f))).digest('hex')
      expect(got, f + ' differs from house-style: change it there and sync').toBe(want)
    }
  })

  it('every logo or icon the app names exists', () => {
    const sources = ['src/components/Shell.tsx', 'src/app/layout.tsx', 'public/manifest.webmanifest']
      .map((f) => readFileSync(path.join(root, f), 'utf8')).join('\n')
    const named = [...new Set([...sources.matchAll(/["'](\/brand\/[^"']+)["']/g)].map((m) => m[1]))]
    expect(named.length).toBeGreaterThanOrEqual(2)
    expect(named.filter((f) => !existsSync(path.join(root, 'public', f)))).toEqual([])
  })
})
