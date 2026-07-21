import { inflateSync } from 'node:zlib'

export function decodePobCode(code: string): string {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')
  return inflateSync(Buffer.from(b64, 'base64')).toString('utf8')
}

// pobb.in share link (or text containing one) → paste id; null = raw PoB code
export const pobbInId = (input: string): string | null =>
  /pobb\.in\/([A-Za-z0-9_-]+)/.exec(input)?.[1] ?? null

// maxroll.gg/poe/pob/<id> planner link → profile id
export const maxrollId = (input: string): string | null =>
  /maxroll\.gg\/poe\/pob\/([A-Za-z0-9_-]+)/.exec(input)?.[1] ?? null

// mobalytics.gg build guide link → normalized page url
export const mobalyticsUrl = (input: string): string | null => {
  const m = /mobalytics\.gg\/poe\/builds\/[A-Za-z0-9_-]+/.exec(input)
  return m ? `https://${m[0]}` : null
}
