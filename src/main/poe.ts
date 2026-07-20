import { existsSync } from 'node:fs'

// Game liveness: OS process listing only — no game memory, no injection, no
// input. Covers PathOfExile.exe / _x64 / Steam / _KG, same names under Proton.
const WSL_TASKLIST = '/mnt/c/Windows/System32/tasklist.exe'
export const POE_CMD =
  process.platform === 'win32'
    ? 'tasklist /FI "IMAGENAME eq PathOfExile*" /NH'
    : existsSync(WSL_TASKLIST) // WSL: the game runs on the Windows host
      ? `${WSL_TASKLIST} /FI "IMAGENAME eq PathOfExile*" /NH`
      : 'pgrep -fa PathOfExile'

// pgrep exits 1 on no-match, tasklist prints an INFO line; anything else
// (missing binary, locked-down shell) fails safe as "running" — a broken
// check must never pause someone's timer.
export const poeIsRunning = (err: { code?: number | string } | null, stdout: string): boolean =>
  err && err.code !== 1 ? true : /pathofexile/i.test(stdout)
