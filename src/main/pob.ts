import { inflateSync } from 'node:zlib'

export function decodePobCode(code: string): string {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')
  return inflateSync(Buffer.from(b64, 'base64')).toString('utf8')
}

// pobb.in share link (or text containing one) → paste id; null = raw PoB code
export const pobbInId = (input: string): string | null =>
  /pobb\.in\/([A-Za-z0-9_-]+)/.exec(input)?.[1] ?? null
