// Path of Building XML parsing — pure string work, safe to import from any process.
export type PobGem = { gemId: string; name: string; level: number; quality: number; enabled: boolean }
export type SocketGroup = { slot: string; label: string; enabled: boolean; gems: PobGem[] }
export type PobSkillSet = { id: string; title: string; groups: SocketGroup[] }
export type TreeSpec = {
  title: string
  nodeCount: number
  nodes: string[]
  mastery: Record<string, string> // node id → chosen effect id
}
export type PobBuild = {
  className: string
  ascendancy: string
  level: number | null
  bandit: string | null
  activeSkillSet: string | null
  skillSets: PobSkillSet[]
  specs: TreeSpec[]
  notes: string
}

// the level-up log line carries the base class, or the ascendancy name once ascended
export const classMatches = (cls: string, b: Pick<PobBuild, 'className' | 'ascendancy'>) =>
  b.className === '' || cls === b.className || cls === b.ascendancy

export const COLOR_CODE = /\^x[0-9a-fA-F]{6}|\^\d/g
export const stripColors = (s: string) => s.replace(COLOR_CODE, '')

const unescapeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]] = unescapeXml(m[2])
  return out
}

function parseSkills(block: string): SocketGroup[] {
  const groups: SocketGroup[] = []
  // self-closing <Skill .../> rows are PoB's label-only separators; the
  // alternation keeps a separator from swallowing the next real group's gems
  for (const sk of block.matchAll(/<Skill\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Skill>)/g)) {
    const a = attrs(sk[1])
    const gems: PobGem[] = []
    for (const g of (sk[2] ?? '').matchAll(/<Gem\b([^>]*)\/>/g)) {
      const ga = attrs(g[1])
      if (!ga.nameSpec) continue
      gems.push({
        gemId: ga.gemId ?? '',
        name: ga.nameSpec,
        level: Number(ga.level) || 1,
        quality: Number(ga.quality) || 0,
        enabled: ga.enabled !== 'false'
      })
    }
    const label = stripColors(a.label ?? '')
    // gemless groups with a label are section separators; unlabeled ones are noise
    if (gems.length === 0 && label === '') continue
    groups.push({ slot: a.slot ?? '', label, enabled: a.enabled !== 'false', gems })
  }
  return groups
}

// ponytail: regex over PoB's machine-generated XML; a real XML parser only if PoB output ever surprises us
export function parsePob(xml: string): PobBuild {
  // color codes kept; the notes tab renders them. Join all blocks — the strip below removes all of them.
  const notes = [...xml.matchAll(/<Notes>([\s\S]*?)<\/Notes>/g)]
    .map((m) => unescapeXml(m[1]).trim())
    .filter(Boolean)
    .join('\n\n')
  xml = xml.replace(/<Notes>[\s\S]*?<\/Notes>/g, '')

  const build = attrs(/<Build\b([^>]*)>/.exec(xml)?.[1] ?? '')
  const skillsTag = attrs(/<Skills\b([^>]*)>/.exec(xml)?.[1] ?? '')

  const skillSets: PobSkillSet[] = []
  for (const ss of xml.matchAll(/<SkillSet\b([^>]*)>([\s\S]*?)<\/SkillSet>/g)) {
    const a = attrs(ss[1])
    skillSets.push({ id: a.id ?? '', title: stripColors(a.title ?? ''), groups: parseSkills(ss[2]) })
  }
  if (skillSets.length === 0) {
    // old PoB exports: Skills contains Skill elements directly
    const m = /<Skills\b[^>]*>([\s\S]*?)<\/Skills>/.exec(xml)
    if (m) skillSets.push({ id: '1', title: '', groups: parseSkills(m[1]) })
  }

  const specs: TreeSpec[] = []
  for (const sp of xml.matchAll(/<Spec\b([^>]*)>/g)) {
    const a = attrs(sp[1])
    const nodes = a.nodes ? a.nodes.split(',') : []
    const mastery: Record<string, string> = {}
    for (const m of (a.masteryEffects ?? '').matchAll(/\{(\d+),(\d+)\}/g)) mastery[m[1]] = m[2]
    specs.push({ title: stripColors(a.title ?? ''), nodeCount: nodes.length, nodes, mastery })
  }

  return {
    className: build.className ?? '',
    ascendancy: build.ascendClassName ?? '',
    level: build.level ? Number(build.level) : null,
    bandit: build.bandit ?? null,
    activeSkillSet: skillsTag.activeSkillSet ?? null,
    skillSets,
    specs,
    notes
  }
}

// exile-leveling route flags for the PoB bandit choice ("None" = kill all)
export function banditFlags(bandit: string | null): string[] {
  switch (bandit) {
    case 'Alira':
      return ['BANDIT_ALIRA']
    case 'Oak':
      return ['BANDIT_OAK']
    case 'Kraityn':
      return ['BANDIT_KRAITYN']
    default:
      return ['BANDIT_KILL']
  }
}

// Prefer the user-picked set, else one named like "levelling", else PoB's
// active set, else the first.
export function levelingSet(build: PobBuild, preferId?: string | null): PobSkillSet | null {
  return (
    (preferId != null ? build.skillSets.find((s) => s.id === preferId) : undefined) ??
    build.skillSets.find((s) => /level/i.test(s.title)) ??
    build.skillSets.find((s) => s.id === build.activeSkillSet) ??
    build.skillSets[0] ??
    null
  )
}
