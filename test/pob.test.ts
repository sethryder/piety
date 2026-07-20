import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePobCode, pobbInId } from '../src/main/pob.ts'
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
  // self-closing separator rows must not swallow real groups' attributes
  for (const set of build.skillSets)
    for (const g of set.groups) assert.ok(!/=/.test(g.label), `separator leaked: ${g.label}`)
})

test('old PoB export: Skill elements directly under Skills', () => {
  const xml = `<?xml version="1.0"?>
<PathOfBuilding>
  <Build className="Witch" ascendClassName="Necromancer"/>
  <Skills>
    <Skill slot="Body Armour" label="Main" enabled="true">
      <Gem nameSpec="Fireball" gemId="Metadata/Items/Gems/SkillGemFireball" level="1" quality="0"/>
    </Skill>
  </Skills>
</PathOfBuilding>`
  const build = parsePob(xml)
  assert.equal(build.skillSets.length, 1)
  assert.equal(build.skillSets[0].groups.length, 1)
  assert.equal(build.skillSets[0].groups[0].gems[0].name, 'Fireball')
  assert.equal(levelingSet(build)?.groups[0].slot, 'Body Armour')
})

test('banditFlags maps PoB bandit to route flags', () => {
  assert.deepEqual(banditFlags('None'), ['BANDIT_KILL'])
  assert.deepEqual(banditFlags(null), ['BANDIT_KILL'])
  assert.deepEqual(banditFlags('Alira'), ['BANDIT_ALIRA'])
  assert.deepEqual(banditFlags('Oak'), ['BANDIT_OAK'])
  assert.deepEqual(banditFlags('Kraityn'), ['BANDIT_KRAITYN'])
})

test('pobbInId extracts paste ids from urls, not raw codes', () => {
  assert.equal(pobbInId('https://pobb.in/AbC123_-x'), 'AbC123_-x')
  assert.equal(pobbInId('pobb.in/XYZ'), 'XYZ')
  assert.equal(pobbInId('eNrtPQlz2zaXn5NfwdWmO'), null)
})

test('xml entities unescaped in titles and labels', () => {
  const xml = `<PathOfBuilding><Build className="Witch"/><Skills activeSkillSet="2">
  <SkillSet id="2" title="Fire &amp; Ice &quot;v2&quot;">
    <Skill slot="Helmet" label="A &gt; B">
      <Gem nameSpec="Fireball"/>
    </Skill>
  </SkillSet>
</Skills></PathOfBuilding>`
  const b = parsePob(xml)
  assert.equal(b.skillSets[0].title, 'Fire & Ice "v2"')
  assert.equal(b.skillSets[0].groups[0].label, 'A > B')
})

test('levelingSet fallback chain: level title, active set, first, null', () => {
  const mk = (id: string, title: string) => ({ id, title, groups: [] })
  const base = {
    className: '',
    ascendancy: '',
    level: null,
    bandit: null,
    specs: []
  }
  // "level" in a title beats the active set
  assert.equal(
    levelingSet({ ...base, activeSkillSet: '2', skillSets: [mk('1', 'Levelling'), mk('2', 'Maps')] })?.id,
    '1'
  )
  assert.equal(
    levelingSet({ ...base, activeSkillSet: '2', skillSets: [mk('1', 'Maps'), mk('2', 'Bossing')] })?.id,
    '2'
  )
  // active id points nowhere: first set wins
  assert.equal(levelingSet({ ...base, activeSkillSet: '9', skillSets: [mk('1', 'Maps')] })?.id, '1')
  assert.equal(levelingSet({ ...base, activeSkillSet: null, skillSets: [] }), null)
})
