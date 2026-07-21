import { useEffect, useMemo, useRef, useState } from 'react'
import { banditFlags, levelingSet, type PobBuild } from '../../shared/pob'
import { activeRouteTexts, buildRoute } from './routeData'
import { dueLabs, tickTrials } from './route'
import { planGems } from './gemPlan'
import { gemDb } from './gemData'
import { fmt, type Run } from './pace'
import { LevelChip, StepLine } from './views'
import { ZoneLayout } from './ZoneLayout'
import { loadProfile } from './profiles'

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
  const [owned, setOwned] = useState<Record<string, boolean>>(() => loadProfile().owned)
  const [trials, setTrials] = useState(() => loadProfile().trials ?? 0)
  const [hiddenLabs, setHiddenLabs] = useState<number[]>(() => loadProfile().hiddenLabs ?? [])
  const [leagueStart, setLeagueStart] = useState<boolean>(() => load('league-start', true))
  const [library, setLibrary] = useState<boolean>(() => load('library', true))
  const [banditOverride, setBanditOverride] = useState<string | null>(() =>
    load('bandit-override', null)
  )
  const [run, setRun] = useState<Run | null>(() => load('pace-run', null))
  const [idx, setIdx] = useState(0)
  const [char, setChar] = useState<{ name: string; level: number } | null>(null)
  const [areaLevel, setAreaLevel] = useState<number | null>(null)
  const [locked, setLocked] = useState<boolean>(() => load('mini-locked', false))
  const [showMap, setShowMap] = useState<boolean>(() => load('mini-map', true))
  const [autoFit, setAutoFit] = useState<boolean>(() => load('mini-autofit', true))
  const [showDue, setShowDue] = useState<boolean>(() => load('mini-due', true))
  const [growUp, setGrowUp] = useState<boolean>(() => load('mini-grow-up', false))
  const [routeTexts, setRouteTexts] = useState<string[]>(() => activeRouteTexts())
  const [skillSet, setSkillSet] = useState<string | null>(() => load('skill-set', null))
  const bodyRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  // freeze the clock while the game is closed; the main window rebases run.start
  // on resume and the storage event delivers the shifted run here
  const [pausedSince, setPausedSince] = useState<number | null>(null)

  // other windows' localStorage writes fire storage events here
  useEffect(() => {
    const refresh = () => {
      setBuild(load('pob-build', null))
      setOwned(loadProfile().owned)
      setTrials(loadProfile().trials ?? 0)
      setHiddenLabs(loadProfile().hiddenLabs ?? [])
      setLeagueStart(load('league-start', true))
      setLibrary(load('library', true))
      setBanditOverride(load('bandit-override', null))
      setRun(load('pace-run', null))
      setAutoFit(load('mini-autofit', true))
      setShowDue(load('mini-due', true))
      setGrowUp(load('mini-grow-up', false))
      setSkillSet(load('skill-set', null))
      // keep the old array identity when unchanged so the visits memo holds
      setRouteTexts((old) => {
        const next = activeRouteTexts()
        return next.length === old.length && next.every((t, i) => t === old[i]) ? old : next
      })
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])

  useEffect(() => {
    window.api.initState().then((s) => {
      setIdx(s.idx)
      if (!s.poeRunning) setPausedSince(Date.now())
    })
    const offIdx = window.api.onIdxSync(setIdx)
    const offPoe = window.api.onPoeStatus((v) => setPausedSince(v ? null : Date.now()))
    const offLog = window.api.onLog((e) => {
      setPausedSince(null) // any live log line proves the game is up
      if (e.type === 'level') setChar({ name: e.name, level: e.level })
      if (e.type === 'gen') setAreaLevel(e.areaLevel)
    })
    return () => {
      offIdx()
      offPoe()
      offLog()
    }
  }, [])

  // lock covers resize too, and reapplies the persisted state on open
  useEffect(() => window.api.setMiniLock(locked), [locked])

  useEffect(() => {
    if (!run || run.total !== null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [run])

  const visits = useMemo(
    () =>
      buildRoute(
        [
          ...(leagueStart ? ['LEAGUE_START'] : []),
          ...(library ? ['LIBRARY'] : []),
          ...banditFlags(banditOverride ?? build?.bandit ?? null)
        ],
        routeTexts
      ),
    [build, leagueStart, library, banditOverride, routeTexts]
  )

  const plan = useMemo(() => {
    const set = build ? levelingSet(build, skillSet) : null
    if (!build || !set) return []
    return planGems(set.groups.flatMap((g) => g.gems), build.className, visits, gemDb)
  }, [build, visits, skillSet])

  const cur = tickTrials(visits[Math.min(idx, visits.length - 1)], trials)
  const due = plan.filter((g) => !g.granted && g.visitIdx <= idx && !owned[g.gemId])
  const labsDue = dueLabs(cur.act, leagueStart ? trials : 12, hiddenLabs)
  const next = visits[idx + 1]
  const elapsed = run ? (run.total ?? (pausedSince ?? now) - run.start) : null

  // content-driven height: measure what the body wants and ask main to fit the
  // window; width stays user-driven. mini-main stretches (flex: 1) so its own
  // height just echoes the window — sum its children instead. Deps re-observe
  // after React swaps conditional blocks; the ResizeObserver catches layout-only
  // changes (async map image loads, width-driven rewrap).
  useEffect(() => {
    const body = bodyRef.current
    if (!autoFit || !body) return
    const natural = (el: HTMLElement) => {
      const kids = ([...el.children] as HTMLElement[]).filter((k) => k.offsetWidth > 0)
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0
      return kids.reduce((a, k) => a + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1)
    }
    const report = () => {
      const cols = ([...body.children] as HTMLElement[]).filter((k) => k.offsetWidth > 0)
      const row = getComputedStyle(body).flexDirection === 'row'
      const heights = cols.map(natural)
      const gap = parseFloat(getComputedStyle(body).rowGap) || 0
      const content = row
        ? Math.max(0, ...heights)
        : heights.reduce((a, h) => a + h, 0) + gap * Math.max(0, cols.length - 1)
      const cs = getComputedStyle(body)
      const chrome = window.innerHeight - body.clientHeight // bar + borders
      window.api.fitMiniHeight(
        Math.ceil(chrome + content + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)),
        growUp
      )
    }
    const ro = new ResizeObserver(report)
    for (const el of body.querySelectorAll('*')) ro.observe(el)
    report()
    return () => ro.disconnect()
  }, [autoFit, showMap, showDue, growUp, cur, due.length, labsDue.length, next])

  function step(d: number) {
    const ni = Math.min(Math.max(idx + d, 0), visits.length - 1)
    setIdx(ni)
    window.api.syncIdx(ni) // main relays it to the main window
  }

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
        <LevelChip
          charLv={char?.level ?? null}
          areaLv={areaLevel}
          town={cur.areaId.endsWith('_town')}
        />
        <span className="mini-char">
          {char ? `${char.name} · ${char.level}` : locked ? '' : 'drag me'}
        </span>
        <span className="spacer" />
        {elapsed !== null && (
          <span className="footer-chip pace-chip">
            {fmt(elapsed)}
            {pausedSince !== null && run?.total === null && ' ⏸'}
          </span>
        )}
        <button className="mini-btn" title="Step route back" disabled={idx === 0} onClick={() => step(-1)}>
          ◀
        </button>
        <button
          className="mini-btn"
          title="Step route forward"
          disabled={idx >= visits.length - 1}
          onClick={() => step(1)}
        >
          ▶
        </button>
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
      <div className="mini-body" ref={bodyRef}>
        <div className="mini-main">
          <h2 className="mini-zone">{cur.zone}</h2>
          <ul className="steps mini-steps">
            {cur.steps.map((s, i) => (
              <StepLine key={i} s={s} />
            ))}
          </ul>
          {showMap && (
            <div className="mini-map-inline">
              <ZoneLayout areaId={cur.areaId} />
            </div>
          )}
          {showDue && (due.length > 0 || labsDue.length > 0) && (
            <div className="mini-due">
              {labsDue.map((l) => (
                <button key={`l${l.lab}`} className="gem-banner mini-banner" title="Mark done" onClick={() => window.api.sendMiniAction({ kind: 'hide-lab', lab: l.lab })}>
                  <span className="tag tag-TRIAL">LAB</span>
                  <b>{l.name} Labyrinth</b>&nbsp;— {l.need}/{l.need} trials, ascend from Aspirants&apos; Plaza
                  <span className="banner-x">✕</span>
                </button>
              ))}
              {due.map((g) => (
                <button key={g.gemId} className="gem-banner mini-banner" title="Mark owned" onClick={() => window.api.sendMiniAction({ kind: 'toggle-owned', gemId: g.gemId })}>
                  <span className="gem-dot" style={{ background: g.color }} />
                  <b>{g.name}</b>&nbsp;— {g.how}
                </button>
              ))}
            </div>
          )}
          {next && (
            <div className="mini-next">
              <span className="micro-label">THEN</span> {next.zone}
            </div>
          )}
        </div>
        {showMap && (
          <div className="mini-map-side">
            <ZoneLayout areaId={cur.areaId} />
          </div>
        )}
      </div>
    </div>
  )
}
