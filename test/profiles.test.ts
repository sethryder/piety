import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claim, claimProfile, lastChar, loadProfile, saveProfile } from '../src/renderer/src/profiles.ts'

// Map-backed localStorage shim for the storage-facing helpers
function stubStorage() {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v)
  }
  return m
}

test('claim resumes an existing named profile', () => {
  const all = { Alice: { owned: { g1: true }, idx: 42 } }
  const { all: next, prof } = claim(all, 'Alice', 7)
  assert.deepEqual(prof, { owned: { g1: true }, idx: 42 })
  assert.deepEqual(next, all)
})

test('claim renames the pending profile when a new char levels up', () => {
  const all = {
    '': { owned: { g1: true }, idx: 3 },
    Old: { owned: { g2: true }, idx: 90 }
  }
  const { all: next, prof } = claim(all, 'Fresh', 3)
  assert.deepEqual(prof, { owned: { g1: true }, idx: 3 })
  assert.equal(next[''], undefined)
  assert.deepEqual(next.Fresh, prof)
  assert.deepEqual(next.Old, all.Old) // other chars untouched
})

test('claim starts fresh at the current position for an unknown char', () => {
  const { all: next, prof } = claim({}, 'Midway', 55)
  assert.deepEqual(prof, { owned: {}, idx: 55 })
  assert.deepEqual(next, { Midway: prof })
})

test('loadProfile adopts legacy owned-gems and survives bad JSON', () => {
  const m = stubStorage()
  m.set('owned-gems', JSON.stringify({ g1: true }))
  assert.deepEqual(loadProfile(), { owned: { g1: true }, idx: 0 })

  // corrupt profiles key: parse failure falls through to the legacy fallback
  m.set('profiles', '{corrupt')
  assert.deepEqual(loadProfile('X'), { owned: { g1: true }, idx: 0 })
  m.set('owned-gems', '{also corrupt')
  assert.deepEqual(loadProfile('X'), { owned: {}, idx: 0 })
})

test('saveProfile / claimProfile roundtrip persists and sets last-char', () => {
  stubStorage()
  saveProfile('', { owned: { a: true }, idx: 5 })
  const prof = claimProfile('Snorri', 5)
  assert.deepEqual(prof, { owned: { a: true }, idx: 5 })
  assert.equal(lastChar(), 'Snorri')
  assert.deepEqual(loadProfile(), { owned: { a: true }, idx: 5 })
})

test('named profile wins over a stale pending one', () => {
  const all = {
    '': { owned: {}, idx: 0 },
    Alice: { owned: { g1: true }, idx: 42 }
  }
  const { all: next, prof } = claim(all, 'Alice', 0)
  assert.equal(prof.idx, 42)
  assert.equal(next[''], undefined)
})
