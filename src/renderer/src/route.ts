// Parser for the exile-leveling step DSL.
// Route data vendored from https://github.com/HeartofPhos/exile-leveling (MIT).

// trial: 1-based route ordinal of a {trial} step; done: decorated at render time
export type Step = { text: string; tags: string[]; hints: string[]; quests?: string[]; trial?: number; done?: boolean }
export type ZoneVisit = { zone: string; act: number; steps: Step[]; areaId: string }

export type LabDue = { lab: number; name: string; need: number }

// cumulative trials gating each lab: 6 normal, 9 cruel, 12 merciless
export const labNeed = (ord: number): number => (ord <= 6 ? 6 : ord <= 9 ? 9 : 12)

// tick a visit's completed trial steps and append (n/need) lab progress
export const tickTrials = (v: ZoneVisit, done: number): ZoneVisit => ({
  ...v,
  steps: v.steps.map((s) => {
    if (!s.trial) return s
    const need = labNeed(s.trial)
    return { ...s, done: s.trial <= done, text: `${s.text} (${Math.min(done, need)}/${need})` }
  })
})

// labs whose trials are banked, minus any the user dismissed (= ran the lab).
// Trials themselves are ordinary route steps; only the lab is a reminder, so it
// can happen at a natural stopping point instead of a fixed route position.
// The act gate matters for non-league-start characters (trials are shared per
// league, so all three unlock at once); on league start the trial count already
// implies the act. ponytail: no log line marks lab completion, dismissal is manual
export const dueLabs = (act: number, trials: number, hidden: number[]): LabDue[] =>
  ['Normal', 'Cruel', 'Merciless'].flatMap((name, i) => {
    const need = [6, 9, 12][i]
    return act >= [3, 7, 10][i] && trials >= need && !hidden.includes(i + 1)
      ? [{ lab: i + 1, name, need }]
      : []
  })

const FRAG_RE = /\{([a-z_]+)(?:\|([^}]*))?\}/g
// destinations referenced by id without a #comment in the route files
const ID_NAMES: Record<string, string> = { Labyrinth_Airlock: "Aspirants' Plaza" }
// quests referenced by id with no #comment on the line; names live in
// data/quests.json but importing it here would tie the parser to the gem db.
// ponytail: two entries; the real-files test fails loudly if upstream adds more
const QUEST_NAMES: Record<string, string> = { a9q3: 'The Storm Blade', a9q5: 'Queen of the Sands' }
// ponytail: assumes {dir|deg} is 0°=north clockwise; fix mapping if arrows look wrong in-game
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

function renderHint(text: string): string {
  return text
    .replace(FRAG_RE, (_m, type: string, rawArg?: string) => {
      const arg = rawArg ?? ''
      if (type === 'dir') return ARROWS[Math.round(Number(arg) / 45) % 8] ?? arg
      return arg
    })
    .trim()
}

export function parseRoute(files: string[], flags: Set<string>): ZoneVisit[] {
  const visits: ZoneVisit[] = []
  let cur: ZoneVisit = { zone: 'The Twilight Strand', act: 1, steps: [], areaId: '1_1_1' }
  let lastStep: Step | null = null
  let lastTown = "Lioneye's Watch"
  let lastTownId = '1_1_town'
  let portalZone = ''
  let portalZoneId = ''
  let trialN = 0

  files.forEach((file, fi) => {
    const act = fi + 1
    // ponytail: act boundary = file boundary; only right if each file ends by entering the next act
    if (cur.steps.length === 0) cur.act = act
    const stack: boolean[] = []

    for (const raw of file.split('\n')) {
      let line = raw.trim()
      if (!line) continue

      const directive = /^#(ifdef|ifndef|endif|section|sub)\s*(.*)$/.exec(line)
      if (directive) {
        const [, kind, rest] = directive
        if (kind === 'ifdef') stack.push(flags.has(rest.trim()))
        else if (kind === 'ifndef') stack.push(!flags.has(rest.trim()))
        else if (kind === 'endif') stack.pop()
        else if (kind === 'sub' && stack.every(Boolean)) lastStep?.hints.push(renderHint(rest))
        continue
      }
      if (!stack.every(Boolean)) continue

      let comment: string | undefined
      const cm = /\s#(.+)$/.exec(line)
      if (cm) {
        comment = cm[1].trim()
        line = line.slice(0, cm.index)
      }

      const tags: string[] = []
      const questIds: string[] = []
      let move: string | null = null
      let moveId = ''
      let stepTrial = 0
      const text = line
        .replace(FRAG_RE, (_m, type: string, rawArg: string | undefined, offset: number) => {
          const arg = rawArg ?? ''
          switch (type) {
            case 'kill':
              tags.push('KILL')
              return arg
            case 'enter':
              tags.push('GO')
              move = comment ?? arg
              moveId = arg
              return comment ?? arg
            case 'waypoint': {
              tags.push('WP')
              const dest = comment ?? ID_NAMES[arg]
              if (dest) {
                move = dest
                moveId = arg
              }
              return dest ?? arg
            }
            case 'waypoint_get':
              tags.push('WP')
              return 'waypoint'
            case 'quest': {
              // upstream allows {quest|questId|rewardOfferId}; only the quest
              // id matters here, and gemPlan matches quests by that bare id
              tags.push('QUEST')
              const qid = arg.split('|')[0]
              questIds.push(qid)
              return comment ?? QUEST_NAMES[qid] ?? qid
            }
            case 'quest_text':
              tags.push('QUEST')
              // upstream renders this fragment as a styled chunk, so
              // "3x{quest_text|Glyph}" reads fine there; flattened to plain
              // text the space must be restored
              return /\w$/.test(line.slice(0, offset)) ? ` ${arg}` : arg
            case 'trial':
              tags.push('TRIAL')
              stepTrial = ++trialN
              return 'Trial of Ascendancy'
            case 'ascend':
              tags.push('TRIAL')
              return `Ascend (${arg})`
            case 'portal':
              tags.push('PORT')
              if (arg === 'set') {
                portalZone = cur.zone
                portalZoneId = cur.areaId
              } else if (portalZone) {
                move = portalZone
                moveId = portalZoneId
              }
              return 'portal'
            case 'logout':
              tags.push('LOG')
              move = lastTown
              moveId = lastTownId
              return 'Logout'
            case 'arena':
              tags.push('GO')
              return arg
            case 'generic':
              tags.push('FIND')
              return arg
            case 'crafting':
              tags.push('FIND')
              return 'crafting recipe'
            case 'area':
              return comment ?? ID_NAMES[arg] ?? arg
            case 'dir':
              return ARROWS[Math.round(Number(arg) / 45) % 8] ?? arg
            default:
              return arg
          }
        })
        .trim()

      lastStep = { text, tags: [...new Set(tags)], hints: [] }
      if (questIds.length) lastStep.quests = questIds
      if (stepTrial) lastStep.trial = stepTrial
      cur.steps.push(lastStep)

      if (move) {
        visits.push(cur)
        if (moveId.endsWith('_town')) {
          lastTown = move
          lastTownId = moveId
        }
        cur = { zone: move, act, steps: [], areaId: moveId }
      }
    }
  })

  visits.push(cur)
  return visits
}

// Nearest matching visit: stay if already there, else the closest match in
// either direction, preferring forward on ties. Walking back into a town must
// match the town visit just behind, not one far ahead (which would skip zones
// and stamp their splits prematurely).
function scan(visits: ZoneVisit[], cur: number, match: (v: ZoneVisit) => boolean): number {
  if (visits[cur] && match(visits[cur])) return cur
  for (let d = 1; d < visits.length; d++) {
    if (cur + d < visits.length && match(visits[cur + d])) return cur + d
    if (cur - d >= 0 && match(visits[cur - d])) return cur - d
  }
  return cur
}

// Towns are hubs: selling trips, deaths, and gem-vendor detours land in one
// constantly. A town match only moves the position when it's adjacent to the
// current visit — planned transitions always are — so an unscheduled town trip
// never yanks the guide forward or back.
// ponytail: a second character wandering NON-town zones on the same client can
// still yank position; per-character log filtering is the upgrade if that bites
function guardTown(visits: ZoneVisit[], cur: number, ni: number): number {
  return visits[ni].areaId.endsWith('_town') && Math.abs(ni - cur) > 1 ? cur : ni
}

export const advance = (visits: ZoneVisit[], cur: number, zone: string): number =>
  guardTown(visits, cur, scan(visits, cur, (v) => v.zone === zone))

// Primary tracking: area ids from "Generating level" log lines, language-independent.
export const advanceById = (visits: ZoneVisit[], cur: number, areaId: string): number =>
  guardTown(visits, cur, scan(visits, cur, (v) => v.areaId === areaId))
