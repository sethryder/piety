// Tokenizer + linter for the route DSL, mirroring parseRoute's semantics.
// Pure module — shared by the editor overlay and tests.

export type Tok = { cls: string; text: string }
export type Issue = { line: number; msg: string }

// every fragment parseRoute handles, plus passthroughs present in the bundled
// files ({area} renders as its arg via the parser's default case)
export const KNOWN_FRAGS = new Set([
  'kill', 'enter', 'waypoint', 'waypoint_get', 'quest', 'quest_text', 'trial',
  'ascend', 'portal', 'logout', 'arena', 'generic', 'crafting', 'dir', 'area'
])

const FRAG_G = /\{([a-z_]+)(?:\|([^}]*))?\}/g
const DIRECTIVE_RE = /^(#(?:ifdef|ifndef|endif|section|sub))(\s*)(.*)$/

// Invariant: concatenating token texts reproduces the line exactly — the
// highlight overlay sits behind the textarea and must align per character.
export function tokenizeLine(raw: string): Tok[] {
  const toks: Tok[] = []
  const push = (cls: string, text: string) => {
    if (text) toks.push({ cls, text })
  }
  const ws = /^\s*/.exec(raw)![0]
  push('', ws)
  const line = raw.slice(ws.length)

  const d = DIRECTIVE_RE.exec(line)
  if (d) {
    const [, head, gap, rest] = d
    push('rd-dir', head)
    push('', gap)
    if (head === '#ifdef' || head === '#ifndef') push('rd-flag', rest)
    else if (head === '#section') push('rd-dir', rest)
    else pushBody(rest, 'rd-comment', push) // #sub hints can hold fragments
    return toks
  }
  if (line.startsWith('#')) {
    push('rd-bad', line)
    return toks
  }

  const cm = /\s#(.+)$/.exec(line)
  pushBody(cm ? line.slice(0, cm.index) : line, '', push)
  if (cm) push('rd-comment', line.slice(cm.index))
  return toks
}

function pushBody(text: string, base: string, push: (cls: string, text: string) => void) {
  let last = 0
  for (const m of text.matchAll(FRAG_G)) {
    pushPlain(text.slice(last, m.index), base, push)
    const cls = KNOWN_FRAGS.has(m[1]) ? '' : ' rd-bad'
    push('rd-frag' + cls, `{${m[1]}`)
    if (m[2] !== undefined) push('rd-arg' + cls, `|${m[2]}`)
    push('rd-frag' + cls, '}')
    last = m.index + m[0].length
  }
  pushPlain(text.slice(last), base, push)
}

// braces outside a valid fragment are almost certainly typos — mark them
function pushPlain(text: string, base: string, push: (cls: string, text: string) => void) {
  for (const part of text.split(/([{}])/)) push(part === '{' || part === '}' ? 'rd-bad' : base, part)
}

export function lintAct(text: string): Issue[] {
  const issues: Issue[] = []
  const open: number[] = [] // line numbers of unclosed #ifdef/#ifndef
  text.split('\n').forEach((raw, i) => {
    const n = i + 1
    const line = raw.trim()
    if (!line) return
    const d = /^#(ifdef|ifndef|endif|section|sub)\s*(.*)$/.exec(line)
    if (d) {
      const [, kind, rest] = d
      if (kind === 'ifdef' || kind === 'ifndef') {
        if (!rest.trim()) issues.push({ line: n, msg: `#${kind} is missing a flag name` })
        open.push(n)
      } else if (kind === 'endif') {
        if (open.length === 0) issues.push({ line: n, msg: '#endif without #ifdef' })
        else open.pop()
      } else if (kind === 'sub') {
        lintFrags(rest, n, issues)
      }
      return
    }
    if (line.startsWith('#')) {
      issues.push({ line: n, msg: `unknown directive ${line.split(/\s/)[0]}` })
      return
    }
    const cm = /\s#(.+)$/.exec(line)
    lintFrags(cm ? line.slice(0, cm.index) : line, n, issues)
  })
  for (const n of open) issues.push({ line: n, msg: 'unclosed #ifdef — add #endif' })
  return issues
}

function lintFrags(text: string, n: number, issues: Issue[]) {
  let outside = ''
  let last = 0
  for (const m of text.matchAll(FRAG_G)) {
    outside += text.slice(last, m.index)
    last = m.index + m[0].length
    const [, type, arg] = m
    if (!KNOWN_FRAGS.has(type)) issues.push({ line: n, msg: `unknown fragment {${type}}` })
    else if (type === 'dir' && Number.isNaN(Number(arg)))
      issues.push({ line: n, msg: '{dir} needs an angle in degrees' })
    else if ((type === 'enter' || type === 'quest') && !arg)
      issues.push({ line: n, msg: `{${type}} needs an id` })
  }
  outside += text.slice(last)
  if (/[{}]/.test(outside)) issues.push({ line: n, msg: 'stray { or } — malformed fragment?' })
}
