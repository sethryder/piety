import { parseRoute, type ZoneVisit } from './route'

const raw = import.meta.glob('./routes/act-*.txt', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

export const defaultTexts = Object.entries(raw)
  .sort(([a], [b]) => parseInt(a.match(/act-(\d+)/)![1]) - parseInt(b.match(/act-(\d+)/)![1]))
  .map(([, t]) => t)

// custom routes live in localStorage: 'routes' = Record<name, act texts>,
// 'active-route' = name ('' = built-in default)
export function activeRouteTexts(): string[] {
  try {
    const name = JSON.parse(localStorage.getItem('active-route') ?? 'null')
    const acts = name ? JSON.parse(localStorage.getItem('routes') ?? '{}')[name] : null
    return Array.isArray(acts) ? acts : defaultTexts
  } catch {
    return defaultTexts
  }
}

export function buildRoute(
  flags: Iterable<string>,
  texts: string[] = activeRouteTexts()
): ZoneVisit[] {
  return parseRoute(texts, new Set(flags))
}
