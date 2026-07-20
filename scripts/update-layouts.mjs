// Vendor zone layout images from Lailloken/Exile-UI (MIT). Skips files already
// present, so re-runs only fetch what's new. ~470 jpgs, run once per league-ish.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'https://raw.githubusercontent.com/Lailloken/Exile-UI/main/img/GUI/act-decoder'
const outDir = new URL('../src/renderer/src/layouts/', import.meta.url).pathname
mkdirSync(outDir, { recursive: true })

const list = await (await fetch(`${BASE}/file-list.json`)).json()
const names = Object.keys(list).filter((n) => n.endsWith('.jpg'))
console.log(`${names.length} layout images in upstream list`)

let downloaded = 0
let skipped = 0
const queue = [...names]
await Promise.all(
  Array.from({ length: 10 }, async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const dest = `${outDir}${name}`
      if (existsSync(dest)) {
        skipped++
        continue
      }
      const res = await fetch(`${BASE}/zones/${encodeURIComponent(name)}`)
      if (!res.ok) {
        console.warn(`miss: ${name} (${res.status})`)
        continue
      }
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
      downloaded++
    }
  })
)
console.log(`done: ${downloaded} downloaded, ${skipped} already present`)
