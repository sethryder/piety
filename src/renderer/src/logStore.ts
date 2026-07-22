import { useSyncExternalStore } from 'react'

// Module-level log buffer: Client.txt line spam re-renders only the components
// that display lines (footer, LOG tab, wizard), not the whole App tree.
let lines: string[] = []
const subs = new Set<() => void>()

export function pushLine(line: string): void {
  lines = [...lines.slice(-99), line]
  subs.forEach((f) => f())
}

export function useLogLines(): string[] {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => lines
  )
}
