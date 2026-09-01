// Refresh all vendored game data. Run at league start (or whenever upstream updates):
//   npm run update-data
// then: npm test (fixture-based sanity checks), bump version, npm run release.
//
// Sources: HeartofPhos/exile-leveling (routes, gems, quests, characters, and the
// pinned GGG skilltree-export commit per tree version — we reuse their pin).
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sep } from 'node:path'

const EL = 'https://raw.githubusercontent.com/HeartofPhos/exile-leveling/main'
const routesDir = fileURLToPath(new URL('../src/renderer/src/routes/', import.meta.url)) + sep
const dataDir = fileURLToPath(new URL('../src/renderer/src/data/', import.meta.url)) + sep

async function get(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`)
  return r
}

// --- routes ---
// piety shows labs as due-banners (route.ts dueLabs), not route steps: strip
// upstream's lab detours, their lab-boss crafting rewards, and the
// town-waypoint hop that only exists to reach a lab
const LAB_RE = /Labyrinth_Airlock|\{ascend\||\{crafting\|\d+_Labyrinth_boss/
const stripLabDetours = (text) => {
  const lines = text.split('\n')
  return lines
    .filter((l, i) => !LAB_RE.test(l) && !(/\{waypoint\|\d+_\d+_town\}/.test(l) && LAB_RE.test(lines[i + 1] ?? '')))
    .join('\n')
}
// manual step overrides where we route better than upstream, applied after
// lab stripping. Exact multi-line match: if upstream rewrites the section the
// sync fails loudly instead of silently dropping our override.
const OVERRIDES = {
  5: [
    {
      // Kitava's Torments: portal back into the Reliquary and walk out — its
      // Square exit is right by the Cathedral Rooftop, beats the waypoint run
      find: `{logout}
Hand in {quest|a5q7} #Kitava's Torments
{waypoint|1_5_3b} #The Ruined Square
➞ {enter|1_5_8} #The Cathedral Rooftop`,
      replace: `Place {portal|set}
{logout}
Hand in {quest|a5q7} #Kitava's Torments
Take {portal|use} #The Reliquary
➞ {enter|1_5_3b} #The Ruined Square
➞ {enter|1_5_8} #The Cathedral Rooftop`
    }
  ]
}
const applyOverrides = (act, text) => {
  for (const { find, replace } of OVERRIDES[act] ?? []) {
    if (!text.includes(find)) throw new Error(`act-${act}: override no longer matches upstream:\n${find}`)
    text = text.replace(find, replace)
  }
  return text
}
for (let i = 1; i <= 10; i++) {
  const text = await (await get(`${EL}/common/data/routes/act-${i}.txt`)).text()
  writeFileSync(`${routesDir}act-${i}.txt`, applyOverrides(i, stripLabDetours(text)))
}
console.log('routes: act-1..10 updated (lab detours stripped, overrides applied)')

// --- data jsons ---
for (const f of ['gems.json', 'gem-colours.json', 'quests.json', 'characters.json']) {
  const text = await (await get(`${EL}/common/data/json/${f}`)).text()
  writeFileSync(`${dataDir}${f}`, text)
  console.log(`data: ${f} (${text.length} bytes)`)
}

// --- passive tree: newest plain version from exile-leveling's pin table ---
// GGG releases the tree before exile-leveling pins it; override with e.g.
//   TREE_VERSION=3_29 TREE_SHA=<skilltree-export commit> npm run update-data
let latest
if (process.env.TREE_VERSION && process.env.TREE_SHA) {
  latest = {
    v: process.env.TREE_VERSION,
    url: `https://raw.githubusercontent.com/grindinggear/skilltree-export/${process.env.TREE_SHA}/data.json`
  }
} else {
  const seeding = await (await get(`${EL}/seeding/src/build-tree/index.ts`)).text()
  const pins = [...seeding.matchAll(/"(\d+_\d+(?:_[a-z]+)*)":\s*\n?\s*"(https:[^"]+)"/g)]
    .filter(([, v]) => /^\d+_\d+$/.test(v))
    .map(([, v, url]) => ({ v, url }))
  if (pins.length === 0) throw new Error('no tree pins found in exile-leveling seeding file')
  latest = pins.sort((a, b) => {
    const [am, an] = a.v.split('_').map(Number)
    const [bm, bn] = b.v.split('_').map(Number)
    return am - bm || an - bn
  }).at(-1)
}
console.log(`tree: version ${latest.v} from ${latest.url}`)

// orbit 16 uses irregular angles (degrees); others are uniform
const ORBIT_16 = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330]
const raw = await (await get(latest.url)).json()
const { orbitRadii, skillsPerOrbit } = raw.constants

const nodes = {}
// effect id → stat lines, for showing the PoB-chosen mastery effect on hover
const masteryEffects = {}
for (const [id, n] of Object.entries(raw.nodes)) {
  if (id === 'root' || n.group === undefined || n.orbit === undefined) continue
  const group = raw.groups[n.group]
  if (!group) continue
  const r = orbitRadii[n.orbit]
  const per = skillsPerOrbit[n.orbit]
  const deg = per === 16 ? ORBIT_16[n.orbitIndex] : (360 / per) * n.orbitIndex
  const a = (deg * Math.PI) / 180
  const kind = n.classStartIndex !== undefined
    ? 's'
    : n.isKeystone ? 'k'
    : n.isNotable ? 'o'
    : n.isMastery ? 'm'
    : n.isJewelSocket ? 'j'
    : 'n'
  nodes[id] = {
    x: Math.round(group.x + r * Math.sin(a)),
    y: Math.round(group.y - r * Math.cos(a)),
    k: kind,
    n: n.name ?? '',
    ...(n.ascendancyName ? { a: 1 } : {}),
    ...(n.stats?.length ? { s: n.stats } : {})
  }
  for (const e of n.masteryEffects ?? []) masteryEffects[e.effect] = e.stats
}

const seen = new Set()
const edges = []
for (const [id, n] of Object.entries(raw.nodes)) {
  for (const out of n.out ?? []) {
    if (!nodes[id] || !nodes[out]) continue
    if (nodes[id].k === 'm' || nodes[out].k === 'm') continue
    // never draw main-tree ↔ ascendancy connections (GGG data links them for pathing)
    if (!!nodes[id].a !== !!nodes[out].a) continue
    const key = id < out ? `${id}|${out}` : `${out}|${id}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push([id, out])
  }
}

for (const old of readdirSync(dataDir).filter((f) => /^tree-.*\.json$/.test(f))) {
  if (old !== `tree-${latest.v}.json`) {
    unlinkSync(`${dataDir}${old}`)
    console.log(`tree: removed stale ${old}`)
  }
}
const out = {
  version: latest.v,
  bounds: { minX: raw.min_x, minY: raw.min_y, maxX: raw.max_x, maxY: raw.max_y },
  nodes,
  edges,
  masteryEffects
}
writeFileSync(`${dataDir}tree-${latest.v}.json`, JSON.stringify(out))
console.log(
  `tree: tree-${latest.v}.json — ${Object.keys(nodes).length} nodes, ${edges.length} edges`
)
console.log('\ndone. now run: npm test')
