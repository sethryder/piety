import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePobCode, maxrollGuideUrl, maxrollId, maxrollProfileFromGuide, mobalyticsUrl, pastebinRawUrl, pobbInId, poeNinjaRawUrl, youtubeRedirectUrl } from '../src/main/pob.ts'
import { banditFlags, classMatches, levelingSet, parsePob } from '../src/shared/pob.ts'

test('classMatches: base class, ascendancy, unparsed build', () => {
  const b = { className: 'Witch', ascendancy: 'Necromancer' }
  assert.equal(classMatches('Witch', b), true)
  assert.equal(classMatches('Necromancer', b), true) // ascended char still matches
  assert.equal(classMatches('Marauder', b), false)
  assert.equal(classMatches('Marauder', { className: '', ascendancy: '' }), true) // no class in PoB: never warn
})

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
  // mastery picks: node id → effect id, both on-tree
  const withMastery = build.specs.find((s) => Object.keys(s.mastery).length > 0)
  assert.ok(withMastery, 'fixture has mastery picks')
  assert.equal(withMastery!.mastery['43647'], '11723')
  assert.equal(build.skillSets.length, 4)

  const lvl = levelingSet(build)
  assert.equal(lvl?.title, 'Levelling As Absolution')
  assert.ok(lvl!.groups.length > 0)
  assert.ok(lvl!.groups.every((g) => g.gems.every((gem) => gem.name.length > 0)))
  // self-closing separator rows must not swallow real groups' attributes
  // (labels like "======" are legit author-made dividers, so only ban attr blobs)
  for (const set of build.skillSets)
    for (const g of set.groups) assert.ok(!/="/.test(g.label), `separator leaked: ${g.label}`)
  assert.ok(
    build.skillSets.some((s) => s.groups.some((g) => g.gems.length === 0 && g.label !== '')),
    'fixture separators survive parsing'
  )
})

test('labeled gemless groups kept as separators, unlabeled ones dropped', () => {
  const xml = `<PathOfBuilding><Build className="Witch"/><Skills>
  <SkillSet id="1" title="Levelling">
    <Skill label="^x00FF00Level 1-12" enabled="false"/>
    <Skill slot="Body Armour" label="Main" enabled="true">
      <Gem nameSpec="Fireball"/>
    </Skill>
    <Skill slot="Gloves"/>
    <Skill label="Act 6+" enabled="false"></Skill>
  </SkillSet>
</Skills></PathOfBuilding>`
  const groups = parsePob(xml).skillSets[0].groups
  assert.deepEqual(
    groups.map((g) => [g.label || g.slot, g.gems.length]),
    [['Level 1-12', 0], ['Main', 1], ['Act 6+', 0]]
  )
  assert.equal(groups[1].gems[0].name, 'Fireball') // separator didn't swallow it
})

test('notes extracted with entities unescaped, color codes kept for rendering', () => {
  const xml = `<PathOfBuilding><Build className="Witch"/>
  <Notes>^7Buy a ^x00FF00Sapphire Ring ^7for &quot;Merveil&quot; &amp; co.</Notes>
</PathOfBuilding>`
  assert.equal(parsePob(xml).notes, '^7Buy a ^x00FF00Sapphire Ring ^7for "Merveil" & co.')
  assert.equal(parsePob('<PathOfBuilding><Build className="Witch"/></PathOfBuilding>').notes, '')
  // multiple Notes blocks all survive; empty ones are skipped
  const multi = `<PathOfBuilding><Build className="Witch"/>
  <Notes>  </Notes><Notes>first</Notes><Notes>second</Notes></PathOfBuilding>`
  assert.equal(parsePob(multi).notes, 'first\n\nsecond')
})

test('levelingSet prefers an explicitly picked set id', () => {
  const mk = (id: string, title: string) => ({ id, title, groups: [] })
  const build = {
    className: '',
    ascendancy: '',
    level: null,
    bandit: null,
    activeSkillSet: null,
    specs: [],
    skillSets: [mk('1', 'Levelling'), mk('2', 'Endgame')]
  }
  assert.equal(levelingSet(build, '2')?.id, '2')
  assert.equal(levelingSet(build, '9')?.id, '1') // stale pick falls back
  assert.equal(levelingSet(build, null)?.id, '1')
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

test('maxrollId extracts planner ids from pob and planner urls', () => {
  assert.equal(maxrollId('https://maxroll.gg/poe/pob/tcjqpe0t'), 'tcjqpe0t')
  assert.equal(maxrollId('maxroll.gg/poe/pob/abc_-9'), 'abc_-9')
  assert.equal(maxrollId('https://maxroll.gg/poe/planner/2o16wa0c#planner'), '2o16wa0c')
  assert.equal(maxrollId('https://maxroll.gg/poe/build-guides/whatever'), null)
  assert.equal(maxrollId('eNrtPQlz2zaXn5NfwdWmO'), null)
})

test('maxrollGuideUrl normalizes build guide urls', () => {
  assert.equal(
    maxrollGuideUrl('https://maxroll.gg/poe/build-guides/forged-frostbearer-spectre-necromancer-league-starter'),
    'https://maxroll.gg/poe/build-guides/forged-frostbearer-spectre-necromancer-league-starter'
  )
  assert.equal(maxrollGuideUrl('maxroll.gg/poe/build-guides/x-1'), 'https://maxroll.gg/poe/build-guides/x-1')
  assert.equal(
    maxrollGuideUrl('https://maxroll.gg/poe/build-guides/league-starter/kinetic-blast-necromancer'),
    'https://maxroll.gg/poe/build-guides/league-starter/kinetic-blast-necromancer'
  )
  assert.equal(maxrollGuideUrl('https://maxroll.gg/poe/pob/tcjqpe0t'), null)
  assert.equal(maxrollGuideUrl('eNrtPQlz2zaXn5NfwdWmO'), null)
})

test('maxrollProfileFromGuide finds the first pob planner embed', () => {
  const html = `<div data-poe-profile="aaa111" data-poe-id="planner" data-poe-type="atlas"></div>
    <div data-poe-profile="2o16wa0c" data-poe-id="planner" data-poe-type="pob"></div>
    <div data-poe-profile="z4c380af" data-poe-id="planner" data-poe-type="pob"></div>`
  assert.equal(maxrollProfileFromGuide(html), '2o16wa0c')
  // fallback: embed json planner urls when the attribute layout changes
  assert.equal(
    maxrollProfileFromGuide('{"url":"https://maxroll.gg/poe/planner/z4c380af#planner"}'),
    'z4c380af'
  )
  assert.equal(maxrollProfileFromGuide('<html>no planners here</html>'), null)
})

test('pastebinRawUrl normalizes paste links', () => {
  assert.equal(pastebinRawUrl('https://pastebin.com/AbC123xy'), 'https://pastebin.com/raw/AbC123xy')
  assert.equal(pastebinRawUrl('pastebin.com/raw/AbC123xy'), 'https://pastebin.com/raw/AbC123xy')
  assert.equal(pastebinRawUrl('eNrtPQlz2zaXn5NfwdWmO'), null)
})

test('poeNinjaRawUrl normalizes pob share links', () => {
  assert.equal(poeNinjaRawUrl('https://poe.ninja/pob/abc123'), 'https://poe.ninja/pob/raw/abc123')
  assert.equal(poeNinjaRawUrl('https://poe.ninja/poe1/pob/qa'), 'https://poe.ninja/pob/raw/qa')
  assert.equal(poeNinjaRawUrl('poe.ninja/pob/raw/abc123'), 'https://poe.ninja/pob/raw/abc123')
  assert.equal(poeNinjaRawUrl('https://poe.ninja/poe2/pob/abc123'), null)
  assert.equal(poeNinjaRawUrl('https://poe.ninja/builds/xyz'), null)
  assert.equal(poeNinjaRawUrl('eNrtPQlz2zaXn5NfwdWmO'), null)
})

test('youtubeRedirectUrl unwraps video description links', () => {
  assert.equal(
    youtubeRedirectUrl(
      'https://www.youtube.com/redirect?event=video_description&redir_token=x&q=https%3A%2F%2Fpobb.in%2FAbC123'
    ),
    'https://pobb.in/AbC123'
  )
  assert.equal(
    youtubeRedirectUrl('https://youtube.com/redirect?q=https%3A%2F%2Fpastebin.com%2Fxyz&v=1'),
    'https://pastebin.com/xyz'
  )
  assert.equal(youtubeRedirectUrl('https://youtube.com/watch?v=abc'), null)
  assert.equal(youtubeRedirectUrl('https://pobb.in/AbC123'), null)
})

test('mobalyticsUrl normalizes build guide urls', () => {
  assert.equal(
    mobalyticsUrl('https://mobalytics.gg/poe/builds/woolie-spineshatter-champion-leaguestart'),
    'https://mobalytics.gg/poe/builds/woolie-spineshatter-champion-leaguestart'
  )
  assert.equal(mobalyticsUrl('mobalytics.gg/poe/builds/some-build'), 'https://mobalytics.gg/poe/builds/some-build')
  assert.equal(mobalyticsUrl('https://mobalytics.gg/poe/profile/x'), null)
  assert.equal(mobalyticsUrl('eNrtPQlz2zaXn5NfwdWmO'), null)
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
