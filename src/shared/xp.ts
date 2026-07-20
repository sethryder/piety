// XP-penalty band: a zone more than 3 + floor(charLv/16) levels away from the
// character is penalized (https://www.poewiki.net/wiki/Experience).
// 'over' = overleveled for the zone (XP penalty), 'under' = zone above the safe
// band (dangerous, and also penalized).
export function levelStatus(charLv: number, zoneLv: number): 'ok' | 'over' | 'under' {
  const safe = 3 + Math.floor(charLv / 16)
  const d = zoneLv - charLv
  return d < -safe ? 'over' : d > safe ? 'under' : 'ok'
}
