import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type BuildFile = { name: string; path: string; mtime: number }

// Recursively list PoB build XMLs (folders in PoB become "folder/name" prefixes).
export function listBuildFiles(dir: string, depth = 3, prefix = ''): BuildFile[] {
  const out: BuildFile[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out // no PoB here
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory() && depth > 0) {
      out.push(...listBuildFiles(p, depth - 1, `${prefix}${e.name}/`))
    } else if (e.isFile() && e.name.endsWith('.xml')) {
      out.push({
        name: prefix + e.name.replace(/\.xml$/, ''),
        path: p,
        mtime: statSync(p).mtimeMs
      })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}
