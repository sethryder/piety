import { inflateSync } from 'node:zlib'

export function decodePobCode(code: string): string {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/')
  return inflateSync(Buffer.from(b64, 'base64')).toString('utf8')
}
