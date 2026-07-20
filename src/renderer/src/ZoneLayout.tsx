import { useEffect, useState } from 'react'

// Layout images vendored from Lailloken/Exile-UI (MIT), named "<areaId> <variant>.jpg"
const files = import.meta.glob('./layouts/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const byArea = new Map<string, string[]>()
for (const [path, url] of Object.entries(files)) {
  const m = /\/([^/ ]+) ([^/]+)\.jpg$/.exec(path)
  if (!m) continue
  const list = byArea.get(m[1]) ?? []
  list.push(url)
  byArea.set(m[1], list)
}

export function ZoneLayout({ areaId }: { areaId: string }) {
  const imgs = byArea.get(areaId)
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [areaId])
  if (!imgs?.length) return null
  const idx = Math.min(i, imgs.length - 1)
  return (
    <div
      className="zone-layout"
      title={imgs.length > 1 ? 'Click for the next layout variant' : undefined}
      onClick={() => setI((idx + 1) % imgs.length)}
    >
      <img src={imgs[idx]} alt="zone layout" />
      {imgs.length > 1 && (
        <span className="zone-layout-count">
          {idx + 1}/{imgs.length}
        </span>
      )}
    </div>
  )
}
