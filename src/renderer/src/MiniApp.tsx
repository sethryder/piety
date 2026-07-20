import { useEffect, useMemo, useState } from 'react'
import { banditFlags, levelingSet, type PobBuild } from '../../shared/pob'
import { buildRoute } from './routeData'
import { planGems } from './gemPlan'
import { gemDb } from './gemData'
import { fmt, type Run } from './pace'
import { StepLine } from './views'
import { ZoneLayout } from './ZoneLayout'

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}

// Read-only companion window: state comes from localStorage (written by the main
// window) plus log/idx events relayed by the main process.
export default function MiniApp() {
  const [build, setBuild] = useState<PobBuild | null>(() => load('pob-build', null))
  const [owned, setOwned] = useState<Record<string, boolean>>(() => load('owned-gems', {}))
  const [leagueStart, setLeagueStart] = useState<boolean>(() => load('league-start', true))
  const [banditOverride, setBanditOverride] = useState<string | null>(() =>
    load('bandit-override', null)
  )
  const [run, setRun] = useState<Run | null>(() => load('pace-run', null))
  const [idx, setIdx] = useState(0)
  const [char, setChar] = useState<{ name: string; level: number } | null>(null)
  const [locked, setLocked] = useState<boolean>(() => load('mini-locked', false))
  const [showMap, setShowMap] = useState<boolean>(() => load('mini-map', true))
  const [now, setNow] = useState(() => Date.now())

  // other windows' localStorage writes fire storage events here
  useEffect(() => {
    const refresh = () => {
      setBuild(load('pob-build', null))
      setOwned(load('owned-gems', {}))
      setLeagueStart(load('league-start', true))
      setBanditOverride(load('bandit-override', null))
      setRun(load('pace-run', null))
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])

  useEffect(() => {
    window.api.initState().then((s) => setIdx(s.idx))
    const offIdx = window.api.onIdxSync(setIdx)
    const offLog = window.api.onLog((e) => {
      if (e.type === 'level') setChar({ name: e.name, level: e.level })
    })
    return () => {
      offIdx()
      offLog()
    }
  }, [])

  useEffect(() => {
    if (!run || run.total !== null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [run])

  const visits = useMemo(
    () =>
      buildRoute([
        ...(leagueStart ? ['LEAGUE_START'] : []),
        ...banditFlags(banditOverride ?? build?.bandit ?? null)
      ]),
    [build, leagueStart, banditOverride]
  )

  const plan = useMemo(() => {
    const set = build ? levelingSet(build) : null
    if (!build || !set) return []
    return planGems(set.groups.flatMap((g) => g.gems), build.className, visits, gemDb)
  }, [build, visits])

  const cur = visits[Math.min(idx, visits.length - 1)]
  const due = plan.filter((g) => !g.granted && g.visitIdx <= idx && !owned[g.gemId])
  const next = visits[idx + 1]
  const elapsed = run ? (run.total ?? now - run.start) : null

  function toggleLock() {
    setLocked((l) => {
      localStorage.setItem('mini-locked', JSON.stringify(!l))
      return !l
    })
  }

  return (
    <div className="mini">
      <div className={`mini-bar ${locked ? '' : 'drag'}`}>
        <span className="act-chip">A{cur.act}</span>
        <span className="mini-char">
          {char ? `${char.name} · ${char.level}` : locked ? '' : 'drag me'}
        </span>
        <span className="spacer" />
        {elapsed !== null && <span className="footer-chip pace-chip">{fmt(elapsed)}</span>}
        <button
          className={`mini-btn ${showMap ? '' : 'off'}`}
          title={showMap ? 'Hide zone layout' : 'Show zone layout'}
          onClick={() =>
            setShowMap((m) => {
              localStorage.setItem('mini-map', JSON.stringify(!m))
              return !m
            })
          }
        >
          🗺
        </button>
        <button className="mini-btn" title={locked ? 'Unlock to move' : 'Lock position'} onClick={toggleLock}>
          {locked ? '🔒' : '🔓'}
        </button>
        <button className="mini-btn" title="Close" onClick={() => window.close()}>
          ✕
        </button>
      </div>
      <div className="mini-body">
        <div className="mini-main">
          <h2 className="mini-zone">{cur.zone}</h2>
          <ul className="steps mini-steps">
            {cur.steps.map((s, i) => (
              <StepLine key={i} s={s} />
            ))}
          </ul>
          {due.length > 0 && (
            <div className="mini-due">
              {due.map((g) => (
                <div key={g.gemId} className="gem-banner mini-banner">
                  <span className="gem-dot" style={{ background: g.color }} />
                  <b>{g.name}</b>&nbsp;— {g.how}
                </div>
              ))}
            </div>
          )}
          {next && (
            <div className="mini-next">
              <span className="micro-label">THEN</span> {next.zone}
            </div>
          )}
        </div>
        {showMap && <ZoneLayout areaId={cur.areaId} />}
      </div>
    </div>
  )
}
