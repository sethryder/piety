import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseLine, tailLog } from '../src/main/logtail.ts'
import { poeIsRunning } from '../src/main/poe.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const STAMP = '2026/07/19 12:00:00 123 abc [INFO Client 1]'

test('parseLine', () => {
  assert.deepEqual(parseLine(`${STAMP} : You have entered Lioneye's Watch.`), {
    type: 'enter',
    zone: "Lioneye's Watch"
  })
  assert.deepEqual(parseLine(`${STAMP} : Snorri (Witch) is now level 12`), {
    type: 'level',
    name: 'Snorri',
    cls: 'Witch',
    level: 12
  })
  assert.equal(parseLine(`${STAMP} : Some chat message.`), null)
  assert.deepEqual(
    parseLine('2026/07/19 12:00:01 123 abc [DEBUG Client 1] Generating level 12 area "1_1_11_1" with seed 469718509'),
    { type: 'gen', areaId: '1_1_11_1', areaLevel: 12, seed: 469718509 }
  )
})

test('poeIsRunning fails safe: only positive absence pauses', () => {
  assert.equal(poeIsRunning(null, 'PathOfExileSteam.exe  1234 Console'), true)
  assert.equal(poeIsRunning(null, 'INFO: No tasks are running which match the criteria.'), false)
  assert.equal(poeIsRunning({ code: 1 }, ''), false) // pgrep no-match
  assert.equal(poeIsRunning({ code: 127 }, ''), true) // missing binary: never pause
  assert.equal(poeIsRunning({ code: 'ENOENT' }, ''), true) // spawn failure: never pause
  assert.equal(poeIsRunning({}, ''), true) // unknown failure: fail safe
})

test('tailLog emits only new lines, holds partial writes', async () => {
  const p = join(tmpdir(), `tail-${process.pid}.log`)
  writeFileSync(p, 'preexisting line\n')
  const events: Array<{ type: string; [k: string]: unknown }> = []
  const stop = tailLog(p, (e) => events.push(e), 20)

  await sleep(50)
  assert.equal(events.length, 0, 'must start at end of file')

  appendFileSync(p, `${STAMP} : You have entered The Coast.\r\npartial`)
  await sleep(80)
  assert.deepEqual(
    events.find((e) => e.type === 'enter'),
    { type: 'enter', zone: 'The Coast' }
  )
  assert.ok(!events.some((e) => e.line === 'partial'), 'partial line must be held back')

  appendFileSync(p, ' completed\n')
  await sleep(80)
  assert.ok(events.some((e) => e.line === 'partial completed'))

  stop()
})

test('tailLog recovers from rotation and transient file loss', async () => {
  const p = join(tmpdir(), `tail-rot-${process.pid}.log`)
  writeFileSync(p, 'old line one\nold line two\n')
  const events: Array<{ type: string; [k: string]: unknown }> = []
  const stop = tailLog(p, (e) => events.push(e), 20)
  await sleep(50)

  // rotation: a truncated file must be re-read from the start
  writeFileSync(p, `${STAMP} : You have entered The Coast.\n`)
  await sleep(80)
  assert.ok(
    events.some((e) => e.type === 'enter' && e.zone === 'The Coast'),
    'rotated file content missed'
  )

  // transient loss: file briefly gone, then recreated — tailer keeps polling
  rmSync(p)
  await sleep(60)
  writeFileSync(p, 'fresh\n')
  await sleep(80)
  assert.ok(
    events.some((e) => e.line === 'fresh'),
    'recreated file content missed'
  )

  stop()
})
