import { useEffect, useState } from 'react'
import kinds from './data/layout-kinds.json'

// Layout images vendored from Lailloken/Exile-UI (MIT), named "<areaId> <variant>.jpg"
const files = import.meta.glob('./layouts/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

// Upstream frames each image by meaning (white = decoded, orange = sample); we
// crop the frame off and re-surface it as a labeled chip via layout-kinds.json
// (regenerate with scripts/layout-kinds.mjs after re-vendoring).
const KIND: Record<string, { label: string; tip: string }> = {
  e: { label: 'EXACT', tip: 'One of this zone’s known layouts — cycle and match your minimap' },
  s: { label: 'SAMPLE', tip: 'Example layout — your instance may differ' }
}

const byArea = new Map<string, { url: string; kind?: string }[]>()
for (const [path, url] of Object.entries(files)) {
  const m = /\/([^/ ]+) ([^/]+)\.jpg$/.exec(path)
  if (!m) continue
  const list = byArea.get(m[1]) ?? []
  list.push({ url, kind: (kinds as Record<string, string>)[`${m[1]} ${m[2]}`] })
  byArea.set(m[1], list)
}

export function ZoneLayout({ areaId }: { areaId: string }) {
  const imgs = byArea.get(areaId)
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [areaId])
  if (!imgs?.length) return null
  const idx = Math.min(i, imgs.length - 1)
  const kind = imgs[idx].kind ? KIND[imgs[idx].kind!] : undefined
  return (
    <div
      className="zone-layout"
      title={imgs.length > 1 ? 'Click: next layout variant · right-click: previous' : undefined}
      onClick={() => setI((idx + 1) % imgs.length)}
      onContextMenu={(e) => {
        e.preventDefault()
        setI((idx - 1 + imgs.length) % imgs.length)
      }}
    >
      <img
        src={imgs[idx].url}
        alt="zone layout"
        onLoad={(e) => {
          // crop the baked-in frame (≈3px + jpeg bleed) off framed images only;
          // per-axis so wide images don't lose extra content, none for
          // borderless sections whose art runs to the edge
          const el = e.currentTarget
          el.style.clipPath = imgs[idx].kind
            ? `inset(${(5 / el.naturalHeight) * 100}% ${(5 / el.naturalWidth) * 100}% round 8px)`
            : ''
        }}
      />
      {(kind || imgs.length > 1) && (
        <span className="zone-layout-count" title={kind?.tip}>
          {kind?.label}
          {kind && imgs.length > 1 && ' · '}
          {imgs.length > 1 && `${idx + 1}/${imgs.length}`}
        </span>
      )}
    </div>
  )
}
