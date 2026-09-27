/**
 * Exact arithmetic for the chat agent, so figures in a reply are worked out, not guessed.
 * A small parser, never eval: numbers (commas, £ and spaces allowed), + - * / ^, brackets,
 * "20%" as 0.2, and round, floor, ceil, abs, sqrt, min, max, sum.
 */
const FUNCS: Record<string, (...a: number[]) => number> = {
  round: (x, dp = 0) => { const f = 10 ** dp; return Math.round((x + Number.EPSILON) * f) / f },
  floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), sum: (...a) => a.reduce((n, x) => n + x, 0),
}

export function calculate(expression: string): number {
  const src = String(expression || '').replace(/[£$€,\s]/g, '').toLowerCase()
  if (!src) throw new Error('empty expression')
  if (src.length > 500) throw new Error('expression too long')
  let i = 0
  const peek = () => src[i]
  const expect = (c: string) => { if (src[i] !== c) throw new Error(`expected "${c}" at position ${i + 1}`); i++ }
  const expr = (): number => {
    let v = term()
    while (peek() === '+' || peek() === '-') v = src[i++] === '+' ? v + term() : v - term()
    return v
  }
  const term = (): number => {
    let v = unary()
    while (peek() === '*' || peek() === '/' || peek() === 'x') {
      const op = src[i++]
      const r = unary()
      if (op === '/' && r === 0) throw new Error('division by zero')
      v = op === '/' ? v / r : v * r
    }
    return v
  }
  // A minus sign binds looser than a power, as in maths: -2^2 is -4, and 2^-1 is 0.5.
  const unary = (): number => (peek() === '-' ? (i++, -unary()) : peek() === '+' ? (i++, unary()) : power())
  const power = (): number => {
    const b = postfix()
    if (peek() === '^') { i++; return b ** unary() }
    return b
  }
  const postfix = (): number => {
    let v = atom()
    while (peek() === '%') { i++; v /= 100 }
    return v
  }
  const atom = (): number => {
    if (peek() === '(') { i++; const v = expr(); expect(')'); return v }
    const num = src.slice(i).match(/^\d+(?:\.\d+)?|^\.\d+/)
    if (num) { i += num[0].length; return parseFloat(num[0]) }
    const name = src.slice(i).match(/^[a-z]+/)
    if (name && FUNCS[name[0]]) {
      i += name[0].length
      expect('(')
      const args = [expr()]
      while (peek() === ';' || peek() === '|') { i++; args.push(expr()) } // commas are stripped as thousands separators
      expect(')')
      return FUNCS[name[0]](...args)
    }
    throw new Error(peek() === undefined ? 'unexpected end' : `unexpected "${peek()}" at position ${i + 1}`)
  }
  const v = expr()
  if (i < src.length) throw new Error(`unexpected "${src[i]}" at position ${i + 1}`)
  if (!Number.isFinite(v)) throw new Error('the result is not a finite number')
  return Math.round(v * 1e10) / 1e10
}
