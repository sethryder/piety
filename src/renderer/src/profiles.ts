// Per-character profiles: owned-gem marks and route position, keyed by the
// character name from level-up log lines. '' is the pending profile for a
// brand-new character that hasn't been named by its first level-up yet.
// ponytail: build/tree config stays global; make it per-profile if juggling
// different builds across characters bites
export type Profile = { owned: Record<string, boolean>; idx: number; trials?: number; hiddenLabs?: number[] }

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}

export const lastChar = (): string => read('last-char', '')

export function loadProfile(name = lastChar()): Profile {
  // legacy: owned-gems predates profiles; adopt it as the starting profile
  return (
    read<Record<string, Profile>>('profiles', {})[name] ?? {
      owned: read('owned-gems', {}),
      idx: 0
    }
  )
}

export function saveProfile(name: string, prof: Profile): void {
  const all = read<Record<string, Profile>>('profiles', {})
  all[name] = prof
  localStorage.setItem('profiles', JSON.stringify(all))
}

// Pure core of the level-line switch: resume the named profile, else claim the
// pending '' one (a new char just got named), else start fresh at the current
// position (app adopted mid-campaign).
export function claim(
  all: Record<string, Profile>,
  name: string,
  curIdx: number
): { all: Record<string, Profile>; prof: Profile } {
  const prof = all[name] ?? all[''] ?? { owned: {}, idx: curIdx }
  const next = { ...all, [name]: prof }
  delete next['']
  return { all: next, prof }
}

export function claimProfile(name: string, curIdx: number): Profile {
  const { all, prof } = claim(read('profiles', {}), name, curIdx)
  localStorage.setItem('profiles', JSON.stringify(all))
  localStorage.setItem('last-char', JSON.stringify(name))
  return prof
}
