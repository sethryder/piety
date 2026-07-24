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

export const hasProfile = (name: string): boolean =>
  name in read<Record<string, Profile>>('profiles', {})

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
// position (app adopted mid-campaign). newChar (the "is now level 2" line,
// which fires exactly once per character) skips resume-by-name: a deleted and
// recreated character reuses its name and must not inherit the stale profile.
export function claim(
  all: Record<string, Profile>,
  name: string,
  curIdx: number,
  newChar = false
): { all: Record<string, Profile>; prof: Profile } {
  // a brand-new character starts at the beach, not wherever the previous
  // character left off; mid-campaign adoption keeps the current position
  const fresh = { owned: {}, idx: newChar ? 0 : curIdx }
  const prof = newChar ? (all[''] ?? fresh) : (all[name] ?? all[''] ?? fresh)
  const next = { ...all, [name]: prof }
  delete next['']
  return { all: next, prof }
}

export function claimProfile(name: string, curIdx: number, newChar = false): Profile {
  const { all, prof } = claim(read('profiles', {}), name, curIdx, newChar)
  localStorage.setItem('profiles', JSON.stringify(all))
  localStorage.setItem('last-char', JSON.stringify(name))
  return prof
}
