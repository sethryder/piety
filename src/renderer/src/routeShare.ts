// Share format for custom routes: one JSON file holding the ten act texts.

export const ACTS = 10

export function packRoute(name: string, acts: string[]): string {
  return JSON.stringify({ format: 'piety-route', name, acts }, null, 2)
}

export function unpackRoute(json: string): { name: string; acts: string[] } {
  const d = JSON.parse(json)
  if (
    d?.format !== 'piety-route' ||
    typeof d.name !== 'string' ||
    !Array.isArray(d.acts) ||
    d.acts.length !== ACTS ||
    !d.acts.every((a: unknown) => typeof a === 'string')
  )
    throw new Error('Not a piety route file')
  return { name: d.name.trim() || 'Imported route', acts: d.acts }
}

// "Name", "Name 2", "Name 3", … — first not already taken
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  if (!set.has(name)) return name
  for (let n = 2; ; n++) if (!set.has(`${name} ${n}`)) return `${name} ${n}`
}
