import { useEffect, useMemo, useRef, useState } from 'react'

type TreeNode = { x: number; y: number; k: string; n: string; a?: number; s?: string[] }
type TreeData = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  nodes: Record<string, TreeNode>
  edges: [string, string][]
  masteryEffects?: Record<string, string[]> // effect id → stat lines
}

// newest vendored tree version wins; update-data.mjs keeps exactly one file around
const treeFiles = import.meta.glob('./data/tree-*.json', {
  eager: true,
  import: 'default'
}) as Record<string, TreeData>
const tree = treeFiles[
  Object.keys(treeFiles).sort((a, b) => {
    const va = a.match(/tree-(\d+)_(\d+)/)!.slice(1).map(Number)
    const vb = b.match(/tree-(\d+)_(\d+)/)!.slice(1).map(Number)
    return va[0] - vb[0] || va[1] - vb[1]
  }).at(-1)!
]

const R: Record<string, number> = { n: 28, o: 44, k: 58, j: 34, m: 30, s: 20 }
const nodeList = Object.entries(tree.nodes)

type Box = { x: number; y: number; w: number; h: number }

function fitBox(ids: Iterable<string>, fallback: Box, includeAsc = false): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const id of ids) {
    const n = tree.nodes[id]
    if (!n) continue
    // the ascendancy cluster sits far off to the side and wrecks the zoom
    if (n.a && !includeAsc) continue
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y)
  }
  if (minX === Infinity) {
    return includeAsc ? fallback : fitBox(ids, fallback, true) // ascendancy-only stretch
  }
  const pad = 600
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
}

export function TreeView({
  allocated,
  added,
  removed,
  mastery,
  title,
  pick,
  count,
  auto,
  onPick,
  focusAsc,
  ascPool
}: {
  allocated: Set<string>
  added: string[]
  removed: string[]
  mastery: Record<string, string>
  title: string
  pick: number
  count: number
  auto: boolean
  onPick: (i: number | null) => void
  focusAsc: boolean
  ascPool: string[]
}) {
  const addedSet = useMemo(() => new Set(added), [added])
  const removedSet = useMemo(() => new Set(removed), [removed])
  const full: Box = {
    x: tree.bounds.minX,
    y: tree.bounds.minY,
    w: tree.bounds.maxX - tree.bounds.minX,
    h: tree.bounds.maxY - tree.bounds.minY
  }
  const [box, setBox] = useState<Box>(() =>
    fitBox(added.length ? added : allocated, full)
  )
  // in lab: zoom onto the build's ascendancy cluster; restore the old viewport on exit
  const preLabBox = useRef<Box | null>(null)
  useEffect(() => {
    if (focusAsc) {
      const asc = ascPool.filter((id) => tree.nodes[id]?.a)
      if (!asc.length) return
      preLabBox.current = box
      setBox(fitBox(asc, full, true))
    } else if (preLabBox.current) {
      setBox(preLabBox.current)
      preLabBox.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAsc])
  const [hover, setHover] = useState<{
    x: number
    y: number
    r: number
    id: string
    node: TreeNode
  } | null>(null)
  const [hlId, setHlId] = useState<string | null>(null)
  const drag = useRef<{ px: number; py: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // nodes are a few px across when zoomed out, so hover snaps to the nearest
  // visible node within reach instead of requiring a direct hit
  function onHoverMove(e: React.MouseEvent) {
    if (drag.current) return
    const svg = svgRef.current
    const wrap = wrapRef.current
    // getScreenCTM includes the preserveAspectRatio letterboxing; a manual
    // box.w/rect.width mapping does not, and snapped hover to far-off nodes
    const ctm = svg?.getScreenCTM()
    if (!svg || !wrap || !ctm) return
    const scale = 1 / ctm.a // tree units per screen px
    const { x: mx, y: my } = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    let best: { id: string; node: TreeNode; d: number } | null = null
    for (const [id, n] of nodeList) {
      if (n.k === 'm' && !allocated.has(id) && !removedSet.has(id)) continue
      const d = Math.hypot(n.x - mx, n.y - my)
      if (!best || d < best.d) best = { id, node: n, d }
    }
    // snap reach: node radius + a small margin, floored at 16 screen px when
    // zoomed out so tiny nodes stay hoverable without grabbing from across a gap
    if (!best || best.d > Math.max((R[best.node.k] ?? 28) + 8 * scale, 16 * scale)) {
      setHover(null)
      return
    }
    const wrapRect = wrap.getBoundingClientRect()
    const sp = new DOMPoint(best.node.x, best.node.y).matrixTransform(ctm)
    setHover({
      x: sp.x - wrapRect.left,
      y: sp.y - wrapRect.top,
      r: Math.max((R[best.node.k] ?? 28) + 22, 14 * scale),
      id: best.id,
      node: best.node
    })
  }

  // static scene, memoized once per delta; pan/zoom only touches the viewBox attr
  const scene = useMemo(() => {
    const els: React.JSX.Element[] = []
    for (const [a, b] of tree.edges) {
      const na = tree.nodes[a]
      const nb = tree.nodes[b]
      const on = allocated.has(a) && allocated.has(b)
      const hot = on && (addedSet.has(a) || addedSet.has(b))
      els.push(
        <line
          key={`e${a}-${b}`}
          x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
          // style, not attribute: var() only resolves as a CSS property
          style={{ stroke: hot ? 'var(--positive)' : on ? 'var(--accent)' : '#1a1f27' }}
          strokeWidth={on ? 14 : 8}
        />
      )
    }
    for (const [id, n] of Object.entries(tree.nodes)) {
      const isAdded = addedSet.has(id)
      const isRemoved = removedSet.has(id)
      const isOn = allocated.has(id)
      if (n.k === 'm' && !isOn && !isRemoved) continue // unallocated masteries are noise
      els.push(
        <circle
          key={id}
          cx={n.x} cy={n.y} r={R[n.k] ?? 28}
          style={{
            fill: isAdded ? 'var(--positive)' : isOn ? 'var(--accent)' : '#232933',
            stroke: isRemoved ? 'var(--negative)' : isAdded ? 'var(--positive)' : 'none'
          }}
          strokeWidth={isRemoved ? 12 : isAdded ? 10 : 0}
          strokeOpacity={isAdded ? 0.35 : 1}
          fillOpacity={isRemoved && !isOn ? 0.25 : 1}
        />
      )
    }
    return els
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocated, addedSet, removedSet])

  function onWheel(e: React.WheelEvent) {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return
    const { x: mx, y: my } = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    const f = e.deltaY > 0 ? 1.25 : 0.8
    const w = Math.min(Math.max(box.w * f, 1500), full.w * 1.2)
    const h = (w / box.w) * box.h
    setBox({ x: mx - ((mx - box.x) / box.w) * w, y: my - ((my - box.y) / box.h) * h, w, h })
  }

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { px: e.clientX, py: e.clientY }
    setHover(null)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return onHoverMove(e)
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return
    const dx = (e.clientX - drag.current.px) / ctm.a
    const dy = (e.clientY - drag.current.py) / ctm.a
    drag.current = { px: e.clientX, py: e.clientY }
    setBox((b) => ({ ...b, x: b.x - dx, y: b.y - dy }))
  }

  const notables = added
    .map((id) => ({ id, node: tree.nodes[id] }))
    .filter(({ node }) => node && (node.k === 'o' || node.k === 'k'))
  const smalls = added.length - notables.length
  const hl = hlId ? tree.nodes[hlId] : null

  return (
    <div className="tree-view">
      <div className="tree-head">
        <span className="micro-label">TREE · {title}</span>
        <span className="tree-summary">
          {added.length > 0
            ? `+${added.length} points this stretch` +
              (removed.length ? ` · ${removed.length} refunded` : '')
            : 'no new points in this stretch'}
        </span>
        <span className="spacer" />
        {count > 1 && (
          <>
            <button className="wpicker-btn" onClick={() => onPick((pick - 1 + count) % count)}>
              ◀
            </button>
            <button className="wpicker-btn" onClick={() => onPick((pick + 1) % count)}>
              ▶
            </button>
          </>
        )}
        {!auto && (
          <button className="wpicker-btn" onClick={() => onPick(null)}>
            AUTO
          </button>
        )}
        <button className="wpicker-btn" onClick={() => setBox(fitBox(added.length ? added : allocated, full))}>
          FIT
        </button>
        <button className="wpicker-btn" onClick={() => setBox(full)}>
          ALL
        </button>
      </div>
      <div className="tree-wrap" ref={wrapRef}>
        <svg
          ref={svgRef}
          className="tree-svg"
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onMouseLeave={() => setHover(null)}
        >
          {scene}
          {hover && (
            <circle
              cx={hover.node.x}
              cy={hover.node.y}
              r={hover.r}
              fill="none"
              stroke="#f2f5f9"
              strokeWidth={Math.max(10, hover.r / 8)}
              strokeOpacity={0.9}
              pointerEvents="none"
            />
          )}
          {hl && (
            <circle
              className="tree-hl"
              cx={hl.x}
              cy={hl.y}
              r={(R[hl.k] ?? 28) + 22}
              fill="none"
              stroke="#f2f5f9"
              strokeWidth={12}
            />
          )}
        </svg>
        {hover && (
          <div
            className="tree-tip"
            style={{
              left: Math.min(hover.x + 14, (wrapRef.current?.clientWidth ?? 400) - 240),
              top: hover.y + 14
            }}
          >
            <div className="tree-tip-name">{hover.node.n || 'Passive'}</div>
            {hover.node.s?.map((s, i) => (
              <div key={i} className="tree-tip-stat">
                {s}
              </div>
            ))}
            {hover.node.k === 'm' &&
              tree.masteryEffects?.[mastery[hover.id]]?.map((s, i) => (
                <div key={i} className="tree-tip-stat tree-tip-mastery">
                  {s}
                </div>
              ))}
          </div>
        )}
      </div>
      {added.length > 0 && (
        <div className="tree-list">
          {notables.map(({ id, node }) => (
            <span
              key={id}
              className="socket-chip tree-notable"
              onMouseEnter={() => setHlId(id)}
              onMouseLeave={() => setHlId(null)}
            >
              {node.n}
            </span>
          ))}
          {smalls > 0 && <span className="whint">+{smalls} small passives</span>}
        </div>
      )}
    </div>
  )
}
