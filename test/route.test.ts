import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseRoute, advance, advanceById } from '../src/renderer/src/route.ts'

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
      assert.ok(!s.text.includes('{'), `unparsed fragment in: ${s.text}`)
      assert.ok(!s.text.includes('#'), `unstripped comment in: ${s.text}`)
    }
  }
  assert.equal(v[0].zone, 'The Twilight Strand')
  assert.equal(v.at(-1)!.act, 10)
  // act 10's comment-less {waypoint|Labyrinth_Airlock} must still create a visit
  assert.ok(
    v.some((x) => x.areaId === 'Labyrinth_Airlock' && x.zone === "Aspirants' Plaza"),
    'Labyrinth_Airlock visit missing'
  )
})
