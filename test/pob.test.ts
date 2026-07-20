import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePobCode } from '../src/main/pob.ts'
import { banditFlags, levelingSet, parsePob } from '../src/shared/pob.ts'

test('decodes and parses a real pobb.in export', () => {
  const code = readFileSync(join(import.meta.dirname, 'fixtures/pob-code.txt'), 'utf8')
  const xml = decodePobCode(code)
  assert.ok(xml.startsWith('<?xml'))

  const build = parsePob(xml)
  assert.equal(build.className, 'Witch')
  assert.equal(build.ascendancy, 'Necromancer')
  assert.equal(build.bandit, 'None')
  assert.equal(build.specs.length, 12)
  assert.ok(build.specs.some((s) => s.title === 'Act 1'), 'color codes stripped from titles')
  assert.ok(build.specs.every((s) => s.nodeCount > 0))
  assert.equal(build.skillSets.length, 4)

  const lvl = levelingSet(build)
  assert.equal(lvl?.title, 'Levelling As Absolution')
  assert.ok(lvl!.groups.length > 0)
  assert.ok(lvl!.groups.every((g) => g.gems.every((gem) => gem.name.length > 0)))
})

test('banditFlags maps PoB bandit to route flags', () => {
  assert.deepEqual(banditFlags('None'), ['BANDIT_KILL'])
  assert.deepEqual(banditFlags(null), ['BANDIT_KILL'])
  assert.deepEqual(banditFlags('Alira'), ['BANDIT_ALIRA'])
})
