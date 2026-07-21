// Earliest acquisition point for each build gem, positioned against the route.
// Data shapes from exile-leveling's gems.json / gem-colours.json / quests.json (MIT).
import type { PobGem } from '../../shared/pob'
import type { ZoneVisit } from './route'

export type GemDb = Record<
  string,
  { name: string; primary_attribute: string; required_level: number; is_support: boolean }
>
export type ColourDb = Record<string, string>
export type CharDb = Record<string, { start_gem_id: string; chest_gem_id: string }>
type OfferGems = Record<string, { classes: string[]; npc?: string }>
export type QuestDb = Record<
  string,
  {
    name: string
    act: string
    reward_offers: Record<string, { quest_npc?: string; quest?: OfferGems; vendor?: OfferGems }>
  }
>

export type GemPlanEntry = {
  gemId: string
  name: string
  color: string
  requiredLevel: number
  how: string
  visitIdx: number // earliest route position where obtainable; Infinity = never (trade/mule)
  granted: boolean // start gem / beach-chest gem: you always have it, never shop for it
}

export function planGems(
  gems: PobGem[],
  className: string,
  visits: ZoneVisit[],
  db: { gems: GemDb; colours: ColourDb; quests: QuestDb; characters: CharDb }
): GemPlanEntry[] {
  const char = db.characters[className]
  const questPos = new Map<string, number>()
  visits.forEach((v, i) =>
    v.steps.forEach((s) =>
      s.quests?.forEach((q) => {
        if (!questPos.has(q)) questPos.set(q, i)
      })
    )
  )

  // Royale variants share display names with real gems but no quest offers them;
  // letting one win the name lookup turns its gem into "trade or mule it"
  const byName = new Map(
    Object.entries(db.gems)
      .filter(([id]) => !id.endsWith('Royale'))
      .map(([id, g]) => [g.name, id])
  )
  const unique = new Map<string, PobGem>()
  for (const g of gems) {
    const id = g.gemId || byName.get(g.name) || ''
    if (id && !unique.has(id)) unique.set(id, g)
  }

  const out: GemPlanEntry[] = []
  for (const [gemId] of unique) {
    const info = db.gems[gemId]
    if (gemId === char?.start_gem_id || gemId === char?.chest_gem_id) {
      out.push({
        gemId,
        name: info?.name ?? gemId,
        color: db.colours[info?.primary_attribute ?? 'none'] ?? '#c6cdd7',
        requiredLevel: info?.required_level ?? 1,
        how:
          gemId === char.start_gem_id
            ? 'Starting gem — you begin with it'
            : 'Beach chest on the Twilight Strand',
        visitIdx: 0,
        granted: true
      })
      continue
    }
    let best: { pos: number; how: string } | null = null
    for (const [qid, quest] of Object.entries(db.quests)) {
      const pos = questPos.get(qid)
      if (pos === undefined || (best && pos >= best.pos)) continue
      // empty classes array = offered to every class
      const forUs = (c?: { classes: string[] }) =>
        c !== undefined && (c.classes.length === 0 || c.classes.includes(className))
      // a free quest reward beats a vendor purchase at the same quest
      let reward: string | null = null
      let vendor: string | null = null
      for (const offer of Object.values(quest.reward_offers)) {
        if (reward === null && forUs(offer.quest?.[gemId])) reward = offer.quest_npc ?? '?'
        if (vendor === null && forUs(offer.vendor?.[gemId]))
          vendor = offer.vendor![gemId].npc ?? '?'
      }
      if (reward !== null) best = { pos, how: `Reward — ${reward}, after ${quest.name}` }
      else if (vendor !== null) best = { pos, how: `Buy — ${vendor}, after ${quest.name}` }
    }
    out.push({
      gemId,
      name: info?.name ?? gemId,
      color: db.colours[info?.primary_attribute ?? 'none'] ?? '#c6cdd7',
      requiredLevel: info?.required_level ?? 1,
      how: best?.how ?? 'Not offered to your class — trade or mule it',
      visitIdx: best?.pos ?? Number.POSITIVE_INFINITY,
      granted: false
    })
  }
  return out.sort((a, b) => a.visitIdx - b.visitIdx || a.requiredLevel - b.requiredLevel)
}
