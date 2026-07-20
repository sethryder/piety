// Campaign run timing: splits are cumulative elapsed ms recorded when an act is first entered.
// zones holds the same for route positions (visit index → elapsed); optional for runs stored
// before zone splits existed.
export type Run = {
  start: number
  splits: Record<number, number>
  total: number | null
  zones?: Record<number, number>
}

export const startRun = (now: number): Run => ({ start: now, splits: {}, total: null, zones: {} })

export function recordActEntry(run: Run, act: number, now: number): Run {
  if (act <= 1 || run.splits[act] !== undefined || run.total !== null) return run
  return { ...run, splits: { ...run.splits, [act]: now - run.start } }
}

// ponytail: zone splits keyed by visit index, so PB comparisons assume the same
// route options; store the route flags per run if that ever misleads
export function recordZoneEntry(run: Run, visitIdx: number, now: number): Run {
  if (run.zones?.[visitIdx] !== undefined || run.total !== null) return run
  return { ...run, zones: { ...run.zones, [visitIdx]: now - run.start } }
}

export function finishRun(run: Run, now: number): Run {
  return run.total !== null ? run : { ...run, total: now - run.start }
}

// Best (gold) segment per act across all recorded runs, finished or abandoned.
export function bestSegments(history: Run[]): Record<number, number> {
  const best: Record<number, number> = {}
  for (const r of history)
    for (let act = 1; act <= 10; act++) {
      const s = actSegment(r, act)
      if (s !== null && (best[act] === undefined || s < best[act])) best[act] = s
    }
  return best
}

export function pbOf(history: Run[]): Run | null {
  const done = history.filter((r) => r.total !== null)
  return done.length ? done.reduce((a, b) => (a.total! <= b.total! ? a : b)) : null
}

// Act N's row is complete when act N+1 was entered (act 10 completes at total).
export const actEnd = (r: Run, act: number): number | null =>
  act >= 10 ? r.total : (r.splits[act + 1] ?? null)

// Act N's start: act 1 starts at 0, later acts when first entered.
export const actStart = (r: Run, act: number): number | null =>
  act <= 1 ? 0 : (r.splits[act] ?? null)

// Duration spent inside act N; null until the act is complete.
export function actSegment(r: Run, act: number): number | null {
  const s = actStart(r, act)
  const e = actEnd(r, act)
  return s !== null && e !== null ? e - s : null
}

// Highest act entered so far — the last PB comparison point crossed.
export function lastCrossing(run: Run): number {
  const acts = Object.keys(run.splits).map(Number)
  return acts.length ? Math.max(...acts) : 1
}

export function fmt(ms: number, signed = false): string {
  const neg = ms < 0
  const s = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const core = h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
  return (neg ? '−' : signed ? '+' : '') + core
}
