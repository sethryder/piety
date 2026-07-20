// Path of Building XML parsing — pure string work, safe to import from any process.
export type PobGem = { gemId: string; name: string; level: number; quality: number; enabled: boolean }
export type SocketGroup = { slot: string; label: string; enabled: boolean; gems: PobGem[] }
export type PobSkillSet = { id: string; title: string; groups: SocketGroup[] }
export type TreeSpec = { title: string; nodeCount: number; nodes: string[] }
export type PobBuild = {
  className: string
  ascendancy: string
  level: number | null
  bandit: string | null
  activeSkillSet: string | null
  skillSets: PobSkillSet[]
  specs: TreeSpec[]
}

const stripColors = (s: string) => s.replace(/\^x[0-9a-fA-F]{6}|\^\d/g, '')

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
  // self-closing <Skill .../> rows are PoB's visual separators; drop them so the
  // lazy match can't attribute the next real group's gems to a separator's attrs
  block = block.replace(/<Skill\b[^>]*\/>/g, '')
  for (const sk of block.matchAll(/<Skill\b([^>]*)>([\s\S]*?)<\/Skill>/g)) {
    const a = attrs(sk[1])
    const gems: PobGem[] = []
    for (const g of sk[2].matchAll(/<Gem\b([^>]*)\/>/g)) {
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
    if (gems.length === 0) continue
    groups.push({
      slot: a.slot ?? '',
      label: stripColors(a.label ?? ''),
      enabled: a.enabled !== 'false',
      gems
    })
  }
  return groups
}

// ponytail: regex over PoB's machine-generated XML; a real XML parser only if PoB output ever surprises us
export function parsePob(xml: string): PobBuild {
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
    specs.push({ title: stripColors(a.title ?? ''), nodeCount: nodes.length, nodes })
  }

  return {
    className: build.className ?? '',
    ascendancy: build.ascendClassName ?? '',
    level: build.level ? Number(build.level) : null,
    bandit: build.bandit ?? null,
    activeSkillSet: skillsTag.activeSkillSet ?? null,
    skillSets,
    specs
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

// Prefer the set named like "levelling", else PoB's active set, else the first.
export function levelingSet(build: PobBuild): PobSkillSet | null {
  return (
    build.skillSets.find((s) => /level/i.test(s.title)) ??
    build.skillSets.find((s) => s.id === build.activeSkillSet) ??
    build.skillSets[0] ??
    null
  )
}
