import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'

export type LogEvent =
  | { type: 'line'; line: string }
  | { type: 'enter'; zone: string } // localized name, fires on every entry
  | { type: 'gen'; areaId: string; areaLevel: number; seed: number } // new instances only, language-independent
  | { type: 'level'; name: string; cls: string; level: number }
  | { type: 'slain'; name: string }
  | { type: 'trial' }

const GEN_RE = /\] Generating level (\d+) area "([^"]+)" with seed (\d+)/
const ENTER_RE = /\] : You have entered (.+)\.$/
const LEVEL_RE = /\] : (\S+) \((\w+)\) is now level (\d+)$/
const SLAIN_RE = /\] : (\S+) has been slain\.$/
// the on-screen "Trial Completed" toast is never written to Client.txt; the
// only trace of a plaque completion is Izaro's one-liner comment
const TRIAL_RE = /\] Izaro: /

export function parseLine(line: string): LogEvent | null {
  const gen = GEN_RE.exec(line)
  if (gen) return { type: 'gen', areaId: gen[2], areaLevel: Number(gen[1]), seed: Number(gen[3]) }
  const enter = ENTER_RE.exec(line)
  if (enter) return { type: 'enter', zone: enter[1] }
  const level = LEVEL_RE.exec(line)
  if (level) return { type: 'level', name: level[1], cls: level[2], level: Number(level[3]) }
  const slain = SLAIN_RE.exec(line)
  if (slain) return { type: 'slain', name: slain[1] }
  if (TRIAL_RE.test(line)) return { type: 'trial' }
  return null
}

// Auto-detect fallback; a user-picked path is saved in config.json and wins.
const HOME = process.env.HOME ?? ''
const CANDIDATES = [
  'C:\\Program Files (x86)\\Grinding Gear Games\\Path of Exile\\logs\\Client.txt',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Path of Exile\\logs\\Client.txt',
  '/mnt/c/Program Files (x86)/Grinding Gear Games/Path of Exile/logs/Client.txt',
  '/mnt/c/Program Files (x86)/Steam/steamapps/common/Path of Exile/logs/Client.txt',
  // Linux: PoE under Proton still writes into the normal Steam game dir
  `${HOME}/.local/share/Steam/steamapps/common/Path of Exile/logs/Client.txt`,
  `${HOME}/.steam/steam/steamapps/common/Path of Exile/logs/Client.txt`
]

const STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam',
  '/mnt/c/Program Files (x86)/Steam',
  `${HOME}/.local/share/Steam`,
  `${HOME}/.steam/steam`
]

// Steam library folders from libraryfolders.vdf ("path" entries, backslashes escaped).
export function parseLibraryFolders(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'))
}

function steamCandidates(): string[] {
  const out: string[] = []
  for (const root of STEAM_ROOTS) {
    try {
      const sep = root.includes('\\') ? '\\' : '/'
      const vdf = readFileSync([root, 'steamapps', 'libraryfolders.vdf'].join(sep), 'utf8')
      for (const lib of parseLibraryFolders(vdf)) {
        const libSep = lib.includes('\\') ? '\\' : '/'
        out.push([lib, 'steamapps', 'common', 'Path of Exile', 'logs', 'Client.txt'].join(libSep))
      }
    } catch {
      // no Steam here
    }
  }
  return out
}

export function findClientTxt(): string | null {
  if (process.env.POE_CLIENT_TXT) return process.env.POE_CLIENT_TXT
  return [...CANDIDATES, ...steamCandidates()].find(existsSync) ?? null
}

// Poll for appended bytes; fs.watch misses appends from the game on Windows.
export function tailLog(
  path: string,
  onEvent: (e: LogEvent) => void,
  intervalMs = 500
): () => void {
  let pos = statSync(path).size // start at end: only new lines matter
  let carry = ''

  const timer = setInterval(() => {
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return // file briefly missing (rotation); retry next tick
    }
    if (size < pos) {
      // truncated/rotated (league-start log trims are routine): skip to the new
      // end — replaying retained content would re-fire hours of old events
      pos = size
      carry = ''
      return
    }
    if (size === pos) return

    const fd = openSync(path, 'r')
    const buf = Buffer.alloc(size - pos)
    readSync(fd, buf, 0, buf.length, pos)
    closeSync(fd)
    pos = size

    const lines = (carry + buf.toString('utf8')).split(/\r?\n/)
    carry = lines.pop() ?? '' // last piece may be a partial line still being written
    for (const line of lines) {
      if (!line) continue
      onEvent({ type: 'line', line })
      const parsed = parseLine(line)
      if (parsed) onEvent(parsed)
    }
  }, intervalMs)

  return () => clearInterval(timer)
}
