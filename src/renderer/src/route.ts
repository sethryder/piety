// Parser for the exile-leveling step DSL.
// Route data vendored from https://github.com/HeartofPhos/exile-leveling (MIT).

export type Step = { text: string; tags: string[]; hints: string[]; quests?: string[] }
export type ZoneVisit = { zone: string; act: number; steps: Step[]; areaId: string }

const FRAG_RE = /\{([a-z_]+)(?:\|([^}]*))?\}/g
// destinations referenced by id without a #comment in the route files
const ID_NAMES: Record<string, string> = { Labyrinth_Airlock: "Aspirants' Plaza" }
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
      const text = line
        .replace(FRAG_RE, (_m, type: string, rawArg?: string) => {
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
            case 'quest':
              tags.push('QUEST')
              questIds.push(arg)
              return comment ?? arg
            case 'quest_text':
              tags.push('QUEST')
              return arg
            case 'trial':
              tags.push('TRIAL')
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
            case 'dir':
              return ARROWS[Math.round(Number(arg) / 45) % 8] ?? arg
            default:
              return arg
          }
        })
        .trim()

      lastStep = { text, tags, hints: [] }
      if (questIds.length) lastStep.quests = questIds
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

// Next matching visit: stay if already there, else scan forward; scan from
// the top as manual-backtrack recovery.
function scan(visits: ZoneVisit[], cur: number, match: (v: ZoneVisit) => boolean): number {
  if (visits[cur] && match(visits[cur])) return cur
  for (let i = cur + 1; i < visits.length; i++) if (match(visits[i])) return i
  for (let i = 0; i < cur; i++) if (match(visits[i])) return i
  return cur
}

export const advance = (visits: ZoneVisit[], cur: number, zone: string): number =>
  scan(visits, cur, (v) => v.zone === zone)

// Primary tracking: area ids from "Generating level" log lines, language-independent.
export const advanceById = (visits: ZoneVisit[], cur: number, areaId: string): number =>
  scan(visits, cur, (v) => v.areaId === areaId)
