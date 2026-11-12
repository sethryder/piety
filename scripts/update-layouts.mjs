// Vendor zone layout images from Lailloken/Exile-UI (MIT). Compares git blob
// hashes against upstream, so re-runs fetch new and changed images and remove
// ones upstream dropped. ~470 jpgs, run once per league-ish.
// Afterwards, if anything changed: node scripts/layout-kinds.mjs
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sep } from 'node:path'

const REPO = 'Lailloken/Exile-UI'
const DIR = 'img/GUI/act-decoder/zones'
const outDir = fileURLToPath(new URL('../src/renderer/src/layouts/', import.meta.url)) + sep
mkdirSync(outDir, { recursive: true })

// same hash git uses for file contents, which the contents API reports as `sha`
const blobSha = (buf) =>
  createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')

// contents API lists up to 1000 entries per directory; we have ~470
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIR}?ref=main`, {
  headers: {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
})
if (!res.ok) throw new Error(`HTTP ${res.status} listing ${REPO}/${DIR}`)
const upstream = (await res.json()).filter((e) => e.type === 'file' && e.name.endsWith('.jpg'))
if (upstream.length >= 1000) throw new Error('upstream listing may be truncated (1000 entries)')
console.log(`${upstream.length} layout images upstream`)

let added = 0
let updated = 0
let unchanged = 0
const queue = [...upstream]
await Promise.all(
  Array.from({ length: 10 }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const dest = `${outDir}${e.name}`
      const exists = existsSync(dest)
      if (exists && blobSha(readFileSync(dest)) === e.sha) {
        unchanged++
        continue
      }
      const r = await fetch(e.download_url)
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${e.name}`)
      const buf = Buffer.from(await r.arrayBuffer())
      if (blobSha(buf) !== e.sha) throw new Error(`hash mismatch after download: ${e.name}`)
      writeFileSync(dest, buf)
      console.log(`${exists ? 'updated' : 'added'}: ${e.name}`)
      exists ? updated++ : added++
    }
  })
)

const names = new Set(upstream.map((e) => e.name))
let removed = 0
for (const f of readdirSync(outDir).filter((n) => n.endsWith('.jpg') && !names.has(n))) {
  unlinkSync(`${outDir}${f}`)
  console.log(`removed: ${f}`)
  removed++
}
console.log(`done: ${added} added, ${updated} updated, ${removed} removed, ${unchanged} unchanged`)
if (added + updated + removed) console.log('now run: node scripts/layout-kinds.mjs')
