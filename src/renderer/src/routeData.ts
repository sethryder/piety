import { parseRoute, type ZoneVisit } from './route'

const raw = import.meta.glob('./routes/act-*.txt', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const texts = Object.entries(raw)
  .sort(([a], [b]) => parseInt(a.match(/act-(\d+)/)![1]) - parseInt(b.match(/act-(\d+)/)![1]))
  .map(([, t]) => t)

export function buildRoute(flags: Iterable<string>): ZoneVisit[] {
  return parseRoute(texts, new Set(flags))
}
