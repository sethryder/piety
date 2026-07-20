import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dueLabs, parseRoute, advance, advanceById, tickTrials } from '../src/renderer/src/route.ts'

test('tickTrials and dueLabs: progress, unlock, dismissal', () => {
  const v = parseRoute(['Complete {trial}\n➞ {enter|1_1_2} #The Coast\nComplete {trial}\n'], new Set())
  const ticked = tickTrials(v[0], 1)
  assert.equal(ticked.steps[0].done, true)
  assert.ok(ticked.steps[0].text.endsWith('(1/6)'))
  assert.equal(tickTrials(v[1], 1).steps[0].done, false)
  assert.deepEqual(dueLabs(3, 5, []), []) // not enough trials yet
  assert.deepEqual(dueLabs(3, 6, []).map((l) => l.name), ['Normal'])
  assert.deepEqual(dueLabs(7, 9, []).map((l) => l.lab), [1, 2])
  assert.deepEqual(dueLabs(10, 12, [1, 2]).map((l) => l.name), ['Merciless']) // earlier labs done
  assert.deepEqual(dueLabs(1, 12, []), []) // alt with pre-done trials: act-gated, not all at once
})

const SAMPLE = `#section Act 1
Find and kill {kill|Hillock}
➞ {enter|1_1_town} #Lioneye's Watch
#ifdef LEAGUE_START
    Get {waypoint_get}
#endif
#ifndef LEAGUE_START
    Hand in {quest|a1q4} #Breaking Some Eggs
#endif
➞ {enter|1_1_2} #The Coast
Find {quest_text|Glyph}
    #sub Go {dir|90}
Find bridge, place {portal|set}
{logout}
Take {portal|use}
➞ {enter|1_1_3} #The Mud Flats
`

test('parseRoute groups steps into zone visits', () => {
  const v = parseRoute([SAMPLE], new Set(['LEAGUE_START']))
  assert.deepEqual(
    v.map((x) => x.zone),
    [
      'The Twilight Strand',
      "Lioneye's Watch",
      'The Coast',
      "Lioneye's Watch", // logout -> town
      'The Coast', // portal use -> where it was set
      'The Mud Flats'
    ]
  )
  assert.deepEqual(v.map((x) => x.areaId), [
    '1_1_1',
    '1_1_town',
    '1_1_2',
    '1_1_town', // logout
    '1_1_2', // portal back to where it was set
    '1_1_3'
  ])
  assert.deepEqual(v[0].steps.map((s) => s.text), ['Find and kill Hillock', "➞ Lioneye's Watch"])
  assert.deepEqual(v[0].steps[0].tags, ['KILL'])
  assert.deepEqual(v[1].steps.map((s) => s.text), ['Get waypoint', '➞ The Coast'])
  assert.deepEqual(v[2].steps[0].hints, ['Go →'])
  // quest_text, portal set/use, and logout render text + tags, not just visits
  assert.deepEqual(v[2].steps.map((s) => s.text), [
    'Find Glyph',
    'Find bridge, place portal',
    'Logout'
  ])
  assert.deepEqual(v[2].steps.map((s) => s.tags), [['QUEST'], ['PORT'], ['LOG']])
  // "Take portal" is a step in the town where you take it, not the destination
  assert.deepEqual(v[3].steps.map((s) => s.text), ['Take portal'])
  assert.deepEqual(v[3].steps[0].tags, ['PORT'])
  assert.deepEqual(v[4].steps.map((s) => s.text), ['➞ The Mud Flats'])
})

test('ifndef branch used without flag', () => {
  const v = parseRoute([SAMPLE], new Set())
  assert.equal(v[1].steps[0].text, 'Hand in Breaking Some Eggs')
})

test('advance: stay, forward, backtrack', () => {
  const v = parseRoute([SAMPLE], new Set(['LEAGUE_START']))
  assert.equal(advance(v, 2, 'The Coast'), 2)
  assert.equal(advance(v, 0, 'The Coast'), 2)
  assert.equal(advance(v, 2, "Lioneye's Watch"), 3)
  assert.equal(advance(v, 5, 'The Twilight Strand'), 0)
  assert.equal(advance(v, 2, 'Unknown Zone'), 2)
})

test('advanceById tracks by area id', () => {
  const v = parseRoute([SAMPLE], new Set(['LEAGUE_START']))
  assert.equal(advanceById(v, 0, '1_1_2'), 2)
  assert.equal(advanceById(v, 2, '1_1_2'), 2) // already there
  assert.equal(advanceById(v, 2, '1_1_town'), 3)
  assert.equal(advanceById(v, 5, '1_1_1'), 0) // new character: back to the start
  assert.equal(advanceById(v, 2, 'some_hideout'), 2) // unknown area: stay put
  // walking back into town matches the nearest town visit, not a distant one
  assert.equal(advanceById(v, 4, '1_1_town'), 3)
  // unscheduled town trip (selling, death) from further along: stay put —
  // planned town transitions are always adjacent to the current visit
  assert.equal(advanceById(v, 5, '1_1_town'), 5)
  assert.equal(advance(v, 5, "Lioneye's Watch"), 5)
})

test('equidistant matches prefer forward', () => {
  const v = parseRoute([SAMPLE], new Set(['LEAGUE_START']))
  // The Coast appears at 2 and 4; from the town between them (3) a Coast
  // line must move forward to 4, not backward to 2
  assert.equal(advanceById(v, 3, '1_1_2'), 4)
  assert.equal(advance(v, 3, 'The Coast'), 4)
})

test('remaining fragment types render text and tags', () => {
  const FRAGS = `Enter the {trial}
{ascend|Normal}
Fight in {arena|The Ring of Blades}
Find the {generic|Golden Hand}
Pick up the {crafting}
Take {waypoint|Unknown_Id}
`
  const v = parseRoute([FRAGS], new Set())
  // waypoint with no comment and no known id name moves nowhere
  assert.equal(v.length, 1)
  assert.deepEqual(v[0].steps.map((s) => s.text), [
    'Enter the Trial of Ascendancy',
    'Ascend (Normal)',
    'Fight in The Ring of Blades',
    'Find the Golden Hand',
    'Pick up the crafting recipe',
    'Take Unknown_Id'
  ])
  assert.deepEqual(v[0].steps.map((s) => s.tags), [
    ['TRIAL'],
    ['TRIAL'],
    ['GO'],
    ['FIND'],
    ['FIND'],
    ['WP']
  ])
})

test('dir arrows: cardinal, diagonal, wraparound, non-numeric', () => {
  const DIRS = `Kill {kill|Boss}
    #sub {dir|0}
    #sub {dir|315}
    #sub {dir|360}
    #sub {dir|weird}
`
  const v = parseRoute([DIRS], new Set())
  assert.deepEqual(v[0].steps[0].hints, ['↑', '↖', '↑', 'weird'])
})

test('portal|use before any portal|set moves nowhere', () => {
  const v = parseRoute(['Take {portal|use}\n➞ {enter|1_1_2} #The Coast\n'], new Set())
  assert.deepEqual(v.map((x) => x.zone), ['The Twilight Strand', 'The Coast'])
  assert.deepEqual(v[0].steps[0], { text: 'Take portal', tags: ['PORT'], hints: [] })
})

test('real route files parse clean', () => {
  const dir = join(import.meta.dirname, '../src/renderer/src/routes')
  const files = readdirSync(dir)
    .filter((f) => /^act-\d+\.txt$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
  assert.equal(files.length, 10)

  const v = parseRoute(files, new Set(['LEAGUE_START']))
  assert.ok(v.length > 100, `expected >100 zone visits, got ${v.length}`)
  for (const visit of v) {
    assert.ok(visit.zone.length > 0)
    assert.ok(visit.act >= 1 && visit.act <= 10)
    for (const s of visit.steps) {
      for (const t of [s.text, ...s.hints]) {
        assert.ok(!t.includes('{'), `unparsed fragment in: ${t}`)
        assert.ok(!t.includes('#'), `unstripped comment in: ${t}`)
        assert.ok(!/\ba\d+q\d+\b/.test(t), `raw quest id leaked into: ${t}`)
        assert.ok(!/\b\d_\d+_\w+/.test(t), `raw area id leaked into: ${t}`)
      }
      s.quests?.forEach((q) => assert.doesNotMatch(q, /\|/, `piped quest id ${q}`))
    }
  }
  assert.equal(v[0].zone, 'The Twilight Strand')
  assert.equal(v.at(-1)!.act, 10)
  // trial steps carry sequential ordinals: 6 before normal lab, 9 before cruel, 12 total
  const trialOrds = v.flatMap((x) => x.steps).filter((s) => s.trial).map((s) => s.trial)
  assert.deepEqual(trialOrds, Array.from({ length: 12 }, (_, i) => i + 1))

  // labs are reminder banners, not route steps: no lab detour in the bundled route
  assert.ok(!v.some((x) => x.areaId === 'Labyrinth_Airlock'), 'lab detour left in route')

  // LIBRARY gates the Act 3 Library detour and its a3q12 hand-in (Siosa's gems)
  assert.ok(!v.some((x) => x.areaId === '1_3_17_1'), 'Library visited without LIBRARY flag')
  const lib = parseRoute(files, new Set(['LEAGUE_START', 'LIBRARY']))
  assert.ok(lib.some((x) => x.areaId === '1_3_17_1'), 'Library visit missing with LIBRARY flag')
  assert.ok(
    lib.some((x) => x.steps.some((s) => s.quests?.includes('a3q12'))),
    'a3q12 hand-in missing with LIBRARY flag'
  )
})

test('quest_text jammed against a count gets its space restored', () => {
  const v = parseRoute(['Find 3x{quest_text|Glyph}\nFind {quest_text|Allflame}'], new Set())
  assert.equal(v[0].steps[0].text, 'Find 3x Glyph')
  assert.equal(v[0].steps[1].text, 'Find Allflame')
})

test('two quest fragments on one line yield one QUEST tag', () => {
  const v = parseRoute(['Find {quest_text|Slave Girl}, take {quest_text|Allflame}'], new Set())
  assert.deepEqual(v[0].steps[0].tags, ['QUEST'])
})

test('{area|id} renders the line comment, not the raw id', () => {
  const v = parseRoute(['Find {area|1_2_2a}, place {portal|set} #The Den'], new Set())
  assert.equal(v[0].steps[0].text, 'Find The Den, place portal')
})
