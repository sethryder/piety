import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { decodePobCode } from '../src/main/pob.ts'
import { banditFlags, levelingSet, parsePob } from '../src/shared/pob.ts'
import { parseRoute } from '../src/renderer/src/route.ts'
import { planGems } from '../src/renderer/src/gemPlan.ts'

const root = join(import.meta.dirname, '..')
const dataDir = join(root, 'src/renderer/src/data')
const json = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'))

test('gem plan for the fixture build against the real route', () => {
  const build = parsePob(
    decodePobCode(readFileSync(join(import.meta.dirname, 'fixtures/pob-code.txt'), 'utf8'))
  )
  const routesDir = join(root, 'src/renderer/src/routes')
  const files = readdirSync(routesDir)
    .filter((f) => /^act-\d+\.txt$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]))
    .map((f) => readFileSync(join(routesDir, f), 'utf8'))
  const visits = parseRoute(files, new Set(['LEAGUE_START', ...banditFlags(build.bandit)]))

  const set = levelingSet(build)!
  const plan = planGems(set.groups.flatMap((g) => g.gems), build.className, visits, {
    gems: json('gems.json'),
    colours: json('gem-colours.json'),
    quests: json('quests.json'),
    characters: json('characters.json')
  })

  // the Witch beach-chest gem is granted, not shopped for
  const surge = plan.find((g) => g.name === 'Arcane Surge Support')
  assert.ok(surge?.granted, 'Arcane Surge must be marked granted for Witch')
  assert.match(surge!.how, /chest/i)

  assert.ok(plan.length >= 10, `expected a real shopping list, got ${plan.length}`)
  const obtainable = plan.filter((g) => Number.isFinite(g.visitIdx))
  assert.ok(
    obtainable.length / plan.length > 0.7,
    `most gems should be obtainable: ${obtainable.length}/${plan.length}`
  )
  for (const g of plan) {
    assert.ok(g.name.length > 0)
    assert.match(g.color, /^#/)
    assert.ok(g.requiredLevel >= 1)
  }
  // sorted by acquisition order
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i].visitIdx >= plan[i - 1].visitIdx)
  // the build's main skill must be purchasable somewhere
  const abs = plan.find((g) => g.name === 'Absolution')
  assert.ok(abs && Number.isFinite(abs.visitIdx), 'Absolution should be obtainable')
  assert.match(abs!.how, /after /)
})

test('quest reward beats vendor purchase at the same quest', () => {
  const visits = parseRoute(
    ['Hand in {quest|q1} #Some Quest\n➞ {enter|1_1_2} #The Coast\n'],
    new Set()
  )
  const gemId = 'Metadata/Items/Gems/SkillGemTest'
  const db = {
    gems: {
      [gemId]: { name: 'Test', primary_attribute: 'intelligence', required_level: 1, is_support: false }
    },
    colours: { intelligence: '#7aa7d9' },
    characters: {},
    // vendor offer iterates BEFORE the reward offer: reward must still win
    quests: {
      q1: {
        name: 'Some Quest',
        act: '1',
        reward_offers: {
          a: { vendor: { [gemId]: { classes: [], npc: 'Nessa' } } },
          b: { quest_npc: 'Tarkleigh', quest: { [gemId]: { classes: ['Witch'] } } }
        }
      }
    }
  }
  const plan = planGems(
    [{ gemId, name: 'Test', level: 1, quality: 0, enabled: true }],
    'Witch',
    visits,
    db as never
  )
  assert.match(plan[0].how, /^Reward — Tarkleigh/)
})
