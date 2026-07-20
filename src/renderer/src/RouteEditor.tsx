import { useEffect, useMemo, useRef, useState } from 'react'
import { parseRoute } from './route'
import { defaultTexts } from './routeData'
import { packRoute, unpackRoute, uniqueName } from './routeShare'
import { lintAct, tokenizeLine } from './routeSyntax'

// Full-screen route manager. The DSL text is the editing surface (same syntax as
// exile-leveling); the built-in route is read-only, duplicates are editable.
// The selected route is always the active one — edits show live in the app.
export function RouteEditor({
  routes,
  active,
  setRoutes,
  setActive,
  flags,
  onClose
}: {
  routes: Record<string, string[]>
  active: string
  setRoutes: (r: Record<string, string[]>) => void
  setActive: (n: string) => void
  flags: string[]
  onClose: () => void
}) {
  const [act, setAct] = useState(0)
  const [name, setName] = useState(active)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const hlRef = useRef<HTMLPreElement>(null)

  const custom = active !== '' && routes[active] !== undefined
  const acts = custom ? routes[active] : defaultTexts

  useEffect(() => setName(active), [active])

  const issues = useMemo(() => acts.map(lintAct), [acts])
  const errLines = useMemo(() => new Set(issues[act].map((i) => i.line)), [issues, act])

  // live feedback on the act being edited
  let stat = ''
  try {
    const v = parseRoute([acts[act]], new Set(flags))
    stat = `${v.length} zones · ${v.reduce((a, z) => a + z.steps.length, 0)} steps`
  } catch (e) {
    stat = String(e)
  }

  function duplicate() {
    const n = uniqueName(custom ? `${active} copy` : 'My route', Object.keys(routes))
    setRoutes({ ...routes, [n]: [...acts] })
    setActive(n)
  }

  function rename() {
    const n = name.trim()
    if (!custom || !n || n === active) return setName(active)
    if (routes[n] !== undefined) return setName(active) // name taken: revert
    const { [active]: mine, ...rest } = routes
    setRoutes({ ...rest, [n]: mine })
    setActive(n)
  }

  function remove() {
    if (!custom || !confirm(`Delete route "${active}"?`)) return
    const { [active]: _, ...rest } = routes
    setRoutes(rest)
    setActive('')
  }

  function doExport() {
    const label = custom ? active : 'Default'
    const blob = new Blob([packRoute(label, acts)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${label.replace(/[^\w.-]+/g, '_')}.piety-route.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function doImport(f: File) {
    try {
      const r = unpackRoute(await f.text())
      const final = uniqueName(r.name, Object.keys(routes))
      setRoutes({ ...routes, [final]: r.acts })
      setActive(final)
      setErr(null)
    } catch {
      setErr('Not a valid route file.')
    }
  }

  return (
    <div className="pace-full route-editor">
      <div className="pace-full-head">
        <span className="micro-label">ROUTES</span>
        <span className="spacer" />
        <button className="import-btn" onClick={() => fileRef.current?.click()}>
          IMPORT
        </button>
        <button className="import-btn" onClick={doExport}>
          EXPORT
        </button>
        <button className="import-btn" onClick={onClose}>
          CLOSE
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) doImport(f)
            e.target.value = ''
          }}
        />
      </div>
      <div className="route-toolbar">
        <select value={custom ? active : ''} onChange={(e) => setActive(e.target.value)}>
          <option value="">Default (built-in)</option>
          {Object.keys(routes).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button className="import-btn" onClick={duplicate}>
          DUPLICATE
        </button>
        {custom && (
          <>
            <input
              className="route-name"
              value={name}
              title="Rename route"
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <button className="import-btn" onClick={remove}>
              DELETE
            </button>
          </>
        )}
      </div>
      {err && <div className="hint">{err}</div>}
      <div className="view-toggle route-acts">
        {acts.map((_, i) => (
          <button key={i} className={i === act ? 'active' : ''} onClick={() => setAct(i)}>
            A{i + 1}
            {issues[i].length > 0 && <span className="tab-err">●</span>}
          </button>
        ))}
      </div>
      <div className="route-code">
        <pre className="route-hl" ref={hlRef} aria-hidden>
          {acts[act].split('\n').map((l, i) => (
            <div key={i} className={errLines.has(i + 1) ? 'rl-err' : undefined}>
              {l
                ? tokenizeLine(l).map((t, j) =>
                    t.cls ? (
                      <span key={j} className={t.cls}>
                        {t.text}
                      </span>
                    ) : (
                      t.text
                    )
                  )
                : '\u200B'}
            </div>
          ))}
        </pre>
        <textarea
          className="route-text"
          spellCheck={false}
          wrap="off"
          value={acts[act]}
          readOnly={!custom}
          onChange={(e) => {
            // ponytail: commits per keystroke rebuild the whole route; debounce if typing lags
            const next = [...acts]
            next[act] = e.target.value
            setRoutes({ ...routes, [active]: next })
          }}
          onScroll={(e) => {
            const h = hlRef.current
            if (h) {
              h.scrollTop = e.currentTarget.scrollTop
              h.scrollLeft = e.currentTarget.scrollLeft
            }
          }}
        />
      </div>
      {issues[act].length > 0 && (
        <div className="route-issues">
          {issues[act].slice(0, 3).map((i, j) => (
            <div key={j}>
              L{i.line}: {i.msg}
            </div>
          ))}
          {issues[act].length > 3 && <div>…and {issues[act].length - 3} more</div>}
        </div>
      )}
      <div className="hint route-stat">
        {custom ? '' : 'Built-in route is read-only — DUPLICATE to edit. '}
        Act {act + 1}: {stat} · syntax: {'{enter|area_id} {waypoint|id} {kill|Name} {quest|id}'}{' '}
        {'{trial} {portal|set} {logout}'} · #sub hint · #ifdef FLAG … #endif
      </div>
    </div>
  )
}
