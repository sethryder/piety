import { test } from 'node:test'
import assert from 'node:assert/strict'
import { packRoute, unpackRoute, uniqueName } from '../src/renderer/src/routeShare.ts'

const acts = Array.from({ length: 10 }, (_, i) => `act ${i + 1}`)

test('pack/unpack round-trips and rejects junk', () => {
  assert.deepEqual(unpackRoute(packRoute('My route', acts)), { name: 'My route', acts })
  assert.equal(unpackRoute(packRoute('  ', acts)).name, 'Imported route')
  assert.throws(() => unpackRoute('{"format":"nope"}'))
  assert.throws(() => unpackRoute(packRoute('x', ['one act'])))
  assert.throws(() => unpackRoute(JSON.stringify({ format: 'piety-route', name: 'x', acts: [...acts.slice(1), 7] })))
  assert.throws(() => unpackRoute('not json'))
})

test('uniqueName suffixes taken names', () => {
  assert.equal(uniqueName('A', []), 'A')
  assert.equal(uniqueName('A', ['A']), 'A 2')
  assert.equal(uniqueName('A', ['A', 'A 2']), 'A 3')
})
