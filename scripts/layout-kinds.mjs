// Classify vendored layout images by the border color baked in by upstream
// (Lailloken/Exile-UI Act-Decoder): white = "decoded" (one of the zone's known
// exact layouts), orange = "sample" (non-conclusive example), borderless =
// "divided" continuation section. The app crops the border off, so this map
// re-surfaces the meaning as a UI label. Requires ImageMagick (`magick`).
// Rerun after re-vendoring src/renderer/src/layouts.
import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'src/renderer/src/layouts')

const classify = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  if (r >= 140 && g >= 140 && b >= 140) return 'e' // white: exact/decoded
  if (r >= 140 && g >= 60 && g <= 150 && b <= 90) return 's' // orange: sample
  return null
}

// Average each edge as a 1px strip: a real frame dominates the whole edge
// (avg ≈ frame color), while map art only speckles it (avg ≈ black). Measured
// separation is wide: white ≈ #FCFCFC, orange ≈ #EA7528, borderless ≈ #0E0D0E.
const edgeAvg = (path, crop) =>
  execFileSync('magick', [path, '-crop', crop, '+repage', '-resize', '1x1!', '-format', '%[hex:p{0,0}]', 'info:'])
    .toString()
    .trim()

const out = {}
const tally = { e: 0, s: 0, d: 0 }
for (const f of readdirSync(dir).filter((n) => n.endsWith('.jpg'))) {
  const path = join(dir, f)
  const [w, h] = execFileSync('magick', [path, '-format', '%w %h', 'info:'])
    .toString()
    .split(' ')
    .map(Number)
  const edges = [`${w}x1+0+1`, `${w}x1+0+${h - 2}`, `1x${h}+1+0`, `1x${h}+${w - 2}+0`]
  const kinds = edges.map((c) => classify(edgeAvg(path, c)))
  // a frame runs all four edges; demand near-unanimity so art can't fake one
  const kind = ['e', 's'].find((k) => kinds.filter((x) => x === k).length >= 3) ?? null
  tally[kind ?? 'd']++
  if (kind) out[f.replace(/\.jpg$/, '')] = kind
}

console.log(tally)
if (!tally.e || !tally.s || !tally.d) throw new Error('classification looks wrong — expected all three kinds')
writeFileSync(join(root, 'src/renderer/src/data/layout-kinds.json'), JSON.stringify(out) + '\n')
console.log(`wrote ${Object.keys(out).length} entries`)
