import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { actEnd, actSegment, actStart, bestSegments, finishRun, fmt, lastCrossing, pbOf, rebaseStart, recordActEntry, recordDeath, recordZoneEntry, startRun, totalDeaths, worthStashing } from '../src/renderer/src/pace.ts'
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
  assert.equal(actStart(run, 1), 0)
  assert.equal(actStart(run, 3), 130_000)
  assert.equal(actStart(run, 4), null) // not entered yet
  assert.equal(actSegment(run, 1), 60_000)
  assert.equal(actSegment(run, 2), 70_000) // per-act duration, not cumulative
  assert.equal(actSegment(run, 3), null) // still in progress
  run = recordZoneEntry(run, 0, t0)
  run = recordZoneEntry(run, 1, t0 + 30_000)
  run = recordZoneEntry(run, 1, t0 + 45_000) // re-entering a zone keeps first split
  assert.deepEqual(run.zones, { 0: 0, 1: 30_000 })
  const legacy = recordZoneEntry({ start: t0, splits: {}, total: null }, 2, t0 + 5_000)
  assert.deepEqual(legacy.zones, { 2: 5_000 }) // runs stored before zones existed
  run = recordDeath(run, 2)
  run = recordDeath(run, 3)
  run = recordDeath(run, 3)
  assert.deepEqual(run.deaths, { 2: 1, 3: 2 })
  assert.equal(totalDeaths(run), 3)
  assert.equal(totalDeaths({ start: t0, splits: {}, total: null }), 0) // pre-deaths runs
  run = finishRun(run, t0 + 200_000)
  assert.equal(run.total, 200_000)
  assert.equal(recordDeath(run, 3).deaths![3], 2) // no post-run deaths
  assert.equal(recordZoneEntry(run, 5, t0 + 250_000).zones![5], undefined) // no post-run entries
  assert.equal(actEnd(run, 10), 200_000)

  const slower = { ...run, total: 300_000 }
  assert.equal(pbOf([slower, run, startRun(0)]), run) // incomplete runs ignored

  // best segments pool finished and abandoned runs; an act 1 sprint counts
  // once act 2 is entered, even if the run was reset right after
  const sprint = recordActEntry(startRun(0), 2, 50_000)
  const best = bestSegments([run, sprint])
  assert.equal(best[1], 50_000) // sprint beat the full run's 60_000
  assert.equal(best[2], 70_000) // only the full run completed act 2
  assert.equal(best[3], undefined) // in-progress segments never count
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

test('pace guards: fresh run, post-finish entries, empty history', () => {
  let run = startRun(0)
  assert.equal(lastCrossing(run), 1) // no splits yet
  run = recordActEntry(run, 2, 60_000)
  run = finishRun(run, 100_000)
  assert.equal(recordActEntry(run, 3, 120_000), run) // finished: no new splits
  assert.equal(recordZoneEntry(run, 5, 120_000), run)
  assert.equal(pbOf([]), null)
})

test('rebaseStart preserves elapsed across a pause', () => {
  const run = startRun(1000)
  // paused at t=5000, resumed at t=9000: elapsed stays 4000
  const r = rebaseStart(run, 5000, 9000)
  assert.equal(9000 - r.start, 4000)
})

test('worthStashing: only unfinished runs with at least one act split', () => {
  assert.equal(worthStashing(null), false)
  assert.equal(worthStashing(startRun(0)), false) // nothing recorded
  const run = recordActEntry(startRun(0), 2, 60_000)
  assert.equal(worthStashing(run), true)
  assert.equal(worthStashing(finishRun(run, 100_000)), false) // finished runs stash elsewhere
})

test('autoAssign act bounds', () => {
  assert.equal(autoAssign('Act 10'), 9)
  assert.equal(autoAssign('Act 0'), null)
  assert.equal(autoAssign('Act 11'), null)
  assert.equal(autoAssign('whatever'), null)
})

test('activeSpecIdx: campaign-done fallthrough and no-match null', () => {
  // campaign done with an Early Maps spec picks it
  assert.equal(activeSpecIdx([0, 10], 10, true), 1)
  // campaign done but no Early Maps spec: fall through to act logic
  assert.equal(activeSpecIdx([0, 4], 10, true), 1)
  // every spec above the current act → null
  assert.equal(activeSpecIdx([4, 9], 1), null)
  // null assignments ignored
  assert.equal(activeSpecIdx([null, 0], 1), 1)
})

test('treeDelta with an unassigned active spec still finds a base tree', () => {
  const specs = [{ nodes: ['a'] }, { nodes: ['a', 'b'] }]
  // active spec's breakpoint is null: any assigned spec below still serves as prev
  const d = treeDelta(specs, [0, null], 1)
  assert.deepEqual(d.added, ['b'])
  assert.deepEqual(d.removed, [])
})

test('treeDelta removed nodes and gapped breakpoints', () => {
  const specs = [{ nodes: ['a', 'b'] }, { nodes: ['a', 'c'] }]
  // Act 1 and Act 5 with nothing in between: Act 1 is still the previous tree
  const d = treeDelta(specs, [0, 4], 1)
  assert.deepEqual(d.added, ['c'])
  assert.deepEqual(d.removed, ['b'])
  assert.deepEqual([...d.allocated], ['a', 'c'])
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
