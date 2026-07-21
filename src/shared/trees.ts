// Tree-spec → campaign breakpoint assignment. Index 0-9 = Act 1-10, 10 = Early Maps, 11 = Endgame.
export const BREAKPOINTS = [
  'Act 1', 'Act 2', 'Act 3', 'Act 4', 'Act 5', 'Act 6', 'Act 7', 'Act 8', 'Act 9', 'Act 10',
  'Early Maps', 'Endgame'
]

// Typical character level at the end of each act; "Level N" specs map to the act you hit N in.
const ACT_END_LEVELS = [13, 23, 33, 40, 45, 50, 54, 60, 64, 69]

// Auto-match a PoB spec title ("Act 3", "Level 44", "Early Maps", "End Game Gear") to a breakpoint index.
export function autoAssign(title: string): number | null {
  const act = /\bact\s*(\d+)/i.exec(title)
  if (act) {
    const n = Number(act[1])
    return n >= 1 && n <= 10 ? n - 1 : null
  }
  if (/early\s*map/i.test(title)) return 10
  if (/end\s*game|endgame|min[\s-]*max/i.test(title)) return 11
  const lvl = /\b(?:level|lvl)\s*(\d+)/i.exec(title)
  if (lvl) {
    const n = Number(lvl[1])
    if (n < 1 || n > 100) return null
    const a = ACT_END_LEVELS.findIndex((end) => n <= end)
    return a === -1 ? 10 : a // past act 10 levels = Early Maps
  }
  return null
}

// What changes between the previous breakpoint's tree and the active one:
// the "added" nodes are where your points go during this stretch of the campaign.
export function treeDelta(
  specs: { nodes: string[] }[],
  assign: (number | null)[],
  activeIdx: number
): { allocated: Set<string>; added: string[]; removed: string[] } {
  const cur = new Set(specs[activeIdx]?.nodes ?? [])
  const curBp = assign[activeIdx] ?? 12
  let prevIdx = -1
  let prevBp = -1
  assign.forEach((bp, i) => {
    if (i !== activeIdx && bp !== null && bp < curBp && bp > prevBp) {
      prevBp = bp
      prevIdx = i
    }
  })
  const prev = new Set(prevIdx === -1 ? [] : specs[prevIdx].nodes)
  return {
    allocated: cur,
    added: [...cur].filter((n) => !prev.has(n)),
    removed: [...prev].filter((n) => !cur.has(n))
  }
}

// Active spec: highest act-breakpoint at or below the current act; Early Maps once the campaign is done.
// Returns an index into the assignments/specs array, or null.
export function activeSpecIdx(
  assign: (number | null)[],
  act: number,
  campaignDone = false
): number | null {
  if (campaignDone) {
    const maps = assign.indexOf(10)
    if (maps !== -1) return maps
  }
  let best = -1
  let bestBp = -1
  assign.forEach((bp, i) => {
    if (bp !== null && bp <= 9 && bp + 1 <= act && bp > bestBp) {
      best = i
      bestBp = bp
    }
  })
  return best === -1 ? null : best
}
