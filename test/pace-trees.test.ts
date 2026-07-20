import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { actEnd, finishRun, fmt, lastCrossing, pbOf, recordActEntry, startRun } from '../src/renderer/src/pace.ts'
import { activeSpecIdx, autoAssign, BREAKPOINTS, treeDelta } from '../src/shared/trees.ts'
import { parseLibraryFolders } from '../src/main/logtail.ts'
import { decodePobCode } from '../src/main/pob.ts'
import { parsePob } from '../src/shared/pob.ts'

test('run lifecycle and splits', () => {
  const t0 = 1_000_000
  let run = startRun(t0)
  run = recordActEntry(run, 1, t0 + 1000) // act 1 entry never recorded
  assert.deepEqual(run.splits, {})
  run = recordActEntry(run, 2, t0 + 60_000)
  run = recordActEntry(run, 2, t0 + 99_000) // re-entering an act keeps first split
  assert.equal(run.splits[2], 60_000)
  run = recordActEntry(run, 3, t0 + 130_000)
  assert.equal(actEnd(run, 1), 60_000) // act 1 completes when act 2 entered
  assert.equal(actEnd(run, 2), 130_000)
  assert.equal(actEnd(run, 3), null)
  assert.equal(lastCrossing(run), 3)
  run = finishRun(run, t0 + 200_000)
  assert.equal(run.total, 200_000)
  assert.equal(actEnd(run, 10), 200_000)

  const slower = { ...run, total: 300_000 }
  assert.equal(pbOf([slower, run, startRun(0)]), run) // incomplete runs ignored
})

test('fmt', () => {
  assert.equal(fmt(0), '0:00')
  assert.equal(fmt(119_000), '1:59')
  assert.equal(fmt(3_600_000), '1:00:00')
  assert.equal(fmt(-118_000), '−1:58')
  assert.equal(fmt(118_000, true), '+1:58')
})

test('tree breakpoint assignment on the fixture build', () => {
  const build = parsePob(
    decodePobCode(readFileSync(join(import.meta.dirname, 'fixtures/pob-code.txt'), 'utf8'))
  )
  assert.equal(BREAKPOINTS.length, 12)
  assert.equal(autoAssign('Act 7'), 6)
  assert.equal(autoAssign('Early Maps'), 10)
  assert.equal(autoAssign('End Game Gear'), 11)
  assert.equal(autoAssign('Min Max Gear'), 11)
  assert.equal(autoAssign('my cool tree'), null)

  const assign = build.specs.map((s) => autoAssign(s.title))
  const at = (act: number, done = false) => {
    const i = activeSpecIdx(assign, act, done)
    return i === null ? null : build.specs[i].title
  }
  assert.equal(at(1), 'Act 1')
  assert.equal(at(9), 'Act 8') // fixture has no Act 9 spec: nearest below
  assert.equal(at(10), 'Act 10')
  assert.equal(at(10, true), 'Early Maps')
})

test('tree delta and node coverage against vendored tree data', () => {
  const build = parsePob(
    decodePobCode(readFileSync(join(import.meta.dirname, 'fixtures/pob-code.txt'), 'utf8'))
  )
  const dataDir = join(import.meta.dirname, '../src/renderer/src/data')
  const treeFile = readdirSync(dataDir)
    .filter((f) => /^tree-\d+_\d+\.json$/.test(f))
    .sort()
    .at(-1)!
  const tree = JSON.parse(readFileSync(join(dataDir, treeFile), 'utf8'))
  const assign = build.specs.map((s) => autoAssign(s.title))

  // every allocated node must exist in the vendored tree data, except cluster
  // jewel passives (synthetic ids >= 65536, only in endgame specs)
  for (const spec of build.specs) {
    assert.equal(spec.nodes.length, spec.nodeCount)
    const missing = spec.nodes.filter((n) => !tree.nodes[n] && Number(n) < 65536)
    assert.deepEqual(missing, [], `${spec.title}: nodes missing from tree data`)
  }

  // act 2's delta vs act 1 adds points and allocates act 1's tree as a base
  const act2 = build.specs.findIndex((s) => s.title === 'Act 2')
  const d = treeDelta(build.specs, assign, act2)
  assert.ok(d.added.length > 0, 'act 2 should add nodes over act 1')
  assert.ok(d.allocated.size > d.added.length)

  // act 1 has no previous breakpoint: everything is "added"
  const act1 = build.specs.findIndex((s) => s.title === 'Act 1')
  const d1 = treeDelta(build.specs, assign, act1)
  assert.equal(d1.added.length, d1.allocated.size)
})

test('steam libraryfolders.vdf parsing', () => {
  const vdf = `"libraryfolders"
{
  "0"
  {
    "path"    "C:\\\\Program Files (x86)\\\\Steam"
  }
  "1"
  {
    "path"    "D:\\\\SteamLibrary"
  }
}`
  assert.deepEqual(parseLibraryFolders(vdf), [
    'C:\\Program Files (x86)\\Steam',
    'D:\\SteamLibrary'
  ])
})
