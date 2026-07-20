// Campaign run timing: splits are cumulative elapsed ms recorded when an act is first entered.
export type Run = { start: number; splits: Record<number, number>; total: number | null }

export const startRun = (now: number): Run => ({ start: now, splits: {}, total: null })

export function recordActEntry(run: Run, act: number, now: number): Run {
  if (act <= 1 || run.splits[act] !== undefined || run.total !== null) return run
  return { ...run, splits: { ...run.splits, [act]: now - run.start } }
}

export function finishRun(run: Run, now: number): Run {
  return run.total !== null ? run : { ...run, total: now - run.start }
}

export function pbOf(history: Run[]): Run | null {
  const done = history.filter((r) => r.total !== null)
  return done.length ? done.reduce((a, b) => (a.total! <= b.total! ? a : b)) : null
}

// Act N's row is complete when act N+1 was entered (act 10 completes at total).
export const actEnd = (r: Run, act: number): number | null =>
  act >= 10 ? r.total : (r.splits[act + 1] ?? null)

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
