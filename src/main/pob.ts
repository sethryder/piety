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

// pastebin.com/<id> (plain or /raw) → raw paste url
export const pastebinRawUrl = (input: string): string | null => {
  const m = /pastebin\.com\/(?:raw\/)?([A-Za-z0-9]+)/.exec(input)
  return m ? `https://pastebin.com/raw/${m[1]}` : null
}

// poe.ninja/pob/<id> or poe.ninja/poe1/pob/<id> (plain or /raw) → raw url;
// poe2 links deliberately don't match — not a PoE1 build
export const poeNinjaRawUrl = (input: string): string | null => {
  const m = /poe\.ninja\/(?:poe1\/)?pob\/(?:raw\/)?([A-Za-z0-9]+)/.exec(input)
  return m ? `https://poe.ninja/pob/raw/${m[1]}` : null
}

// youtube.com/redirect?…q=<url> wrapper (links copied from video
// descriptions) → the inner url, for the other matchers to pick apart
export const youtubeRedirectUrl = (input: string): string | null => {
  const m = /youtube\.com\/redirect\?(?:\S*?[?&])?q=([^&\s]+)/.exec(input)
  return m ? decodeURIComponent(m[1]) : null
}
