import { test } from 'node:test'
import assert from 'node:assert/strict'
import { levelStatus } from '../src/shared/xp.ts'

test('levelStatus safe band is 3 + charLv/16', () => {
  // level 10: safe range ±3
  assert.equal(levelStatus(10, 6), 'over')
  assert.equal(levelStatus(10, 7), 'ok')
  assert.equal(levelStatus(10, 13), 'ok')
  assert.equal(levelStatus(10, 14), 'under')
  // level 32: safe range widens to ±5
  assert.equal(levelStatus(32, 26), 'over')
  assert.equal(levelStatus(32, 27), 'ok')
  assert.equal(levelStatus(32, 37), 'ok')
  assert.equal(levelStatus(32, 38), 'under')
})
