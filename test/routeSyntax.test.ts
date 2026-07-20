import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { lintAct, tokenizeLine } from '../src/renderer/src/routeSyntax.ts'

const ROUTES = join(import.meta.dirname, '../src/renderer/src/routes')
const files = readdirSync(ROUTES).filter((f) => f.match(/^act-\d+\.txt$/))

test('bundled route files lint clean', () => {
  for (const f of files) {
    assert.deepEqual(lintAct(readFileSync(join(ROUTES, f), 'utf8')), [], f)
  }
})

test('tokenizeLine reproduces every line exactly (overlay alignment)', () => {
  for (const f of files) {
    for (const line of readFileSync(join(ROUTES, f), 'utf8').split('\n')) {
      assert.equal(tokenizeLine(line).map((t) => t.text).join(''), line)
    }
  }
})

test('lint catches the mistakes it exists for', () => {
  const msgs = (t: string) => lintAct(t).map((i) => `${i.line}:${i.msg}`)
  assert.deepEqual(msgs('Kill {boss|Hillock}'), ['1:unknown fragment {boss}'])
  assert.deepEqual(msgs('#ifdef X\nhi'), ['1:unclosed #ifdef — add #endif'])
  assert.deepEqual(msgs('#endif'), ['1:#endif without #ifdef'])
  assert.deepEqual(msgs('#ifdef'), ['1:#ifdef is missing a flag name', '1:unclosed #ifdef — add #endif'])
  assert.deepEqual(msgs('#secton Act 1'), ['1:unknown directive #secton'])
  assert.deepEqual(msgs('go {enter|1_1_2 #The Coast'), ['1:stray { or } — malformed fragment?'])
  assert.deepEqual(msgs('go {dir|north}'), ['1:{dir} needs an angle in degrees'])
  assert.deepEqual(msgs('➞ {enter}'), ['1:{enter} needs an id'])
  assert.deepEqual(msgs('    #sub hints get checked {portl|x}'), ['1:unknown fragment {portl}'])
  assert.deepEqual(msgs('Find and kill {kill|Hillock}\n➞ {enter|1_1_town} #town'), [])
})

test('tokenizer marks unknown fragments and stray braces', () => {
  const classes = (l: string) => tokenizeLine(l).map((t) => t.cls)
  assert.ok(classes('Kill {boss|X}').some((c) => c.includes('rd-bad')))
  assert.ok(classes('oops } here').includes('rd-bad'))
  assert.deepEqual(classes('#ifdef LEAGUE_START'), ['rd-dir', '', 'rd-flag'])
})
