import { useEffect, useMemo, useRef, useState } from 'react'
import { banditFlags, type PobBuild } from '../../shared/pob'
import { activeSpecIdx, autoAssign, treeDelta } from '../../shared/trees'
import { advance, advanceById } from './route'
import { buildRoute } from './routeData'
import { planGems } from './gemPlan'
import { gemDb } from './gemData'
import { levelingSet } from '../../shared/pob'
import { actSegment, actStart, finishRun, fmt, lastCrossing, pbOf, recordActEntry, recordZoneEntry, startRun, type Run } from './pace'
import { BandView, DenseView, FocusView, MixedView, PaceView, SplitView, type ViewProps } from './views'
import { Wizard, type WizardResult } from './wizard'

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}

function save<T>(key: string, value: T): T {
  localStorage.setItem(key, JSON.stringify(value))
  return value
}

type View = 'FOCUS' | 'MIXED' | 'DENSE' | 'SPLIT'

export default function App() {
  const [build, setBuild] = useState<PobBuild | null>(() => load('pob-build', null))
  // ponytail: owned gems are global, not per-character; profiles fix that later
  const [owned, setOwned] = useState<Record<string, boolean>>(() => load('owned-gems', {}))
  const [ui, setUiState] = useState<{ view: View; mirror?: boolean }>(() =>
    load('ui', { view: 'SPLIT' as View, mirror: false })
  )
  // short window (e.g. FancyZones band on a portrait monitor) forces the compact band layout
  const [shortWindow, setShortWindow] = useState(() => window.innerHeight < 520)
  const [idx, setIdx] = useState(0)
  const [char, setChar] = useState<{ name: string; level: number } | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [logPath, setLogPath] = useState<string | null>(null)
  const [tab, setTab] = useState('GEMS')
  const [leagueStart, setLeagueStart] = useState<boolean>(() => load('league-start', true))
  const [treeAssign, setTreeAssign] = useState<(number | null)[]>(() => load('tree-assign', []))
  const [banditOverride, setBanditOverride] = useState<string | null>(() =>
    load('bandit-override', null)
  )
  const [run, setRun] = useState<Run | null>(() => load('pace-run', null))
  const [history, setHistory] = useState<Run[]>(() => load('pace-history', []))
  const [now, setNow] = useState(() => Date.now())
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(() => load<PobBuild | null>('pob-build', null) === null)
  const [paceOpen, setPaceOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [beta, setBeta] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [pobSource, setPobSource] = useState<string | null>(() => load('pob-source', null))

  useEffect(() => window.api.onUpdateReady(setUpdateVersion), [])

  useEffect(() => {
    window.api.initState().then((s) => {
      setLogPath(s.logPath)
      setAppVersion(s.version)
      setBeta(s.allowPrerelease)
    })
  }, [])

  // keep the mini overlay window on the same route position
  useEffect(() => window.api.syncIdx(idx), [idx])

  function setUi(next: { view: View; mirror?: boolean }) {
    setUiState(save('ui', next))
  }

  useEffect(() => {
    const onResize = () => setShortWindow(window.innerHeight < 520)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  const gemColor = useMemo(
    () => Object.fromEntries(plan.map((g) => [g.gemId, g.color])),
    [plan]
  )

  // refs so a burst of log events in one poll tick sees its own updates
  const idxRef = useRef(idx)
  const runRef = useRef(run)

  // manual zone jumps must update the ref too, or the next log event advances
  // from a stale position
  function jumpTo(i: number) {
    idxRef.current = i
    setIdx(i)
  }

  // route options changed (league start / bandit): the visits array may have
  // shrunk, so clamp the tracked position
  useEffect(() => {
    if (idxRef.current >= visits.length) {
      idxRef.current = visits.length - 1
      setIdx(visits.length - 1)
    }
  }, [visits])

  useEffect(() => {
    const offStatus = window.api.onLogStatus(setLogPath)
    const offLog = window.api.onLog((e) => {
      if (e.type === 'line') {
        setLogLines((l) => [...l.slice(-99), e.line])
      } else if (e.type === 'level') {
        setChar({ name: e.name, level: e.level })
      } else if (e.type === 'gen' || e.type === 'enter') {
        // 'gen' (area id, language-independent, new instances only) is the primary
        // signal; 'enter' (localized name, every entry) is the fallback and a no-op
        // when 'gen' already moved us
        const ni =
          e.type === 'gen'
            ? advanceById(visits, idxRef.current, e.areaId)
            : advance(visits, idxRef.current, e.zone)
        const nowMs = Date.now()
        idxRef.current = ni
        setIdx(ni)

        let r = runRef.current
        // only a brand-new character reaches the Twilight Strand: always a fresh run
        const atStart = e.type === 'gen' ? e.areaId === visits[0].areaId : e.zone === visits[0].zone
        if (atStart) {
          stashPartial(r)
          r = startRun(nowMs)
        }
        if (r) {
          r = recordActEntry(r, visits[ni].act, nowMs)
          r = recordZoneEntry(r, ni, nowMs)
          // finishing requires having entered act 10 first: another character on
          // the same client loading into Karui Shores must not fake a completion
          if (ni === visits.length - 1 && r.total === null && r.splits[10] !== undefined) {
            r = finishRun(r, nowMs)
            setHistory((h) => save('pace-history', [...h, r!]))
          }
        }
        if (r !== runRef.current) {
          runRef.current = r
          setRun(save('pace-run', r))
        }
      }
    })
    return () => {
      offStatus()
      offLog()
    }
  }, [visits])

  // tick the run clock
  useEffect(() => {
    if (!run || run.total !== null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [run])

  const cur = visits[Math.min(idx, visits.length - 1)]
  const due = plan.filter((g) => !g.granted && g.visitIdx <= idx && !owned[g.gemId])
  const pb = useMemo(() => pbOf(history), [history])

  const assign = useMemo(() => {
    if (!build) return []
    return treeAssign.length === build.specs.length
      ? treeAssign
      : build.specs.map((s) => autoAssign(s.title))
  }, [build, treeAssign])

  // linked PoB file: main re-parses on every save; keep manual breakpoint picks by spec title
  const buildRef = useRef(build)
  buildRef.current = build
  const assignRef = useRef(assign)
  assignRef.current = assign

  useEffect(() => {
    window.api.watchBuild(pobSource)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () =>
      window.api.onBuildUpdated((b) => {
        // keep manual breakpoint picks: same index + same title first, then
        // unique non-empty titles (rename/reorder); duplicates and untitled
        // specs can't be title-matched, so they fall back to auto
        const oldSpecs = buildRef.current?.specs ?? []
        const oldAssign = assignRef.current
        const titleCount = new Map<string, number>()
        for (const s of oldSpecs) titleCount.set(s.title, (titleCount.get(s.title) ?? 0) + 1)
        const byTitle = new Map<string, number | null>()
        oldSpecs.forEach((s, i) => {
          if (s.title && titleCount.get(s.title) === 1) byTitle.set(s.title, oldAssign[i])
        })
        const nextAssign = b.specs.map((s, i) =>
          oldSpecs[i]?.title === s.title
            ? (oldAssign[i] ?? autoAssign(s.title))
            : byTitle.has(s.title)
              ? byTitle.get(s.title)!
              : autoAssign(s.title)
        )
        setTreeAssign(save('tree-assign', nextAssign))
        setBuild(save('pob-build', b))
      }),
    []
  )
  const treeIdx = build ? activeSpecIdx(assign, cur.act, idx === visits.length - 1) : null
  const tree = treeIdx !== null && build ? build.specs[treeIdx] : null

  const treeInfo = useMemo(() => {
    // builds stored before spec nodes were kept need a re-import
    if (!build || treeIdx === null || !build.specs[treeIdx].nodes?.length) return null
    return { ...treeDelta(build.specs, assign, treeIdx), title: build.specs[treeIdx].title }
  }, [build, assign, treeIdx])

  function toggleOwned(gemId: string) {
    setOwned((o) => save('owned-gems', { ...o, [gemId]: !o[gemId] }))
  }

  // keep partial runs (act 2+ reached): their segments feed best-act comparisons
  function stashPartial(r: Run | null) {
    if (r && r.total === null && Object.keys(r.splits).length) {
      setHistory((h) => save('pace-history', [...h, r]))
    }
  }

  function resetRun() {
    stashPartial(runRef.current)
    runRef.current = null
    setRun(save('pace-run', null))
  }

  async function checkUpdates() {
    setChecking(true)
    setUpdateMsg(null)
    const r = await window.api.checkUpdates()
    setChecking(false)
    setUpdateMsg(
      r === null
        ? 'Update checks only work in the installed app.'
        : r.latest === null
          ? 'Update check failed — offline or no releases.'
          : r.latest === r.current
            ? `Up to date (v${r.current}).`
            : `v${r.latest} found — downloading, restart prompt appears in the footer when ready.`
    )
  }

  function finishWizard(r: WizardResult) {
    setBuild(save('pob-build', r.build))
    setTreeAssign(save('tree-assign', r.treeAssign))
    setLeagueStart(save('league-start', r.leagueStart))
    setBanditOverride(save('bandit-override', r.bandit))
    setPobSource(save('pob-source', r.sourcePath))
    window.api.watchBuild(r.sourcePath)
    setWizardOpen(false)
  }

  const elapsed = run ? (run.total ?? now - run.start) : null
  const cross = run ? lastCrossing(run) : 1
  // footer chip: finished runs show the final total, live runs show time-in-act
  const chipTime = run && elapsed !== null ? (run.total ?? elapsed - (actStart(run, cross) ?? 0)) : null
  const pbSeg = run && pb ? actSegment(pb, cross) : null
  const paceDelta = !run
    ? null
    : run.total !== null
      ? pb?.total != null
        ? run.total - pb.total
        : null
      : pbSeg !== null
        ? chipTime! - pbSeg
        : null
  const runNo = history.length + (run && run.total === null ? 1 : 0)

  const viewProps: ViewProps = {
    visits,
    idx,
    setIdx: jumpTo,
    cur,
    due,
    plan,
    owned,
    toggleOwned,
    gemColor,
    logLines,
    build,
    tab,
    setTab,
    run,
    pb,
    history,
    now,
    resetRun,
    treeInfo
  }
  const band = shortWindow
  const tailing = logPath !== null

  return (
    <>
      <header className="header">
        <span className={`tail-dot ${tailing ? '' : 'dead'}`} />
        <span className="char">
          {char ? `${char.name} · Lv ${char.level}` : 'No character'}
        </span>
        <span className="act-chip">ACT {cur.act}</span>
        {run && runNo > 0 && <span className="act-chip">RUN {runNo}</span>}
        <span className="spacer" />
        <div className={`view-toggle ${band ? 'dimmed' : ''}`}>
          {(['FOCUS', 'MIXED', 'DENSE', 'SPLIT'] as const).map((v) => (
            <button
              key={v}
              className={ui.view === v ? 'active' : ''}
              onClick={() => setUi({ ...ui, view: v })}
            >
              {v}
            </button>
          ))}
          {ui.view === 'SPLIT' && !band && (
            <button
              className={ui.mirror ? 'active' : ''}
              title="Mirror layout (zone guide on the right)"
              onClick={() => setUi({ ...ui, mirror: !ui.mirror })}
            >
              ⇄
            </button>
          )}
        </div>
        <button className="import-btn" onClick={() => window.api.toggleMini()}>
          MINI
        </button>
        <button className="import-btn" onClick={() => setWizardOpen(true)}>
          {build ? `${build.className} · ${build.ascendancy}` : 'SETUP'}
        </button>
        <button className="import-btn" title="Settings" onClick={() => setSettingsOpen((o) => !o)}>
          ⚙
        </button>
      </header>

      <main className="main">
        {wizardOpen ? (
          <Wizard
            initial={{
              build,
              treeAssign: assign,
              leagueStart,
              bandit: banditOverride,
              sourcePath: pobSource
            }}
            logPath={logPath}
            lastLine={logLines.at(-1) ?? ''}
            canClose={build !== null}
            onClose={() => setWizardOpen(false)}
            onFinish={finishWizard}
          />
        ) : settingsOpen ? (
          <div className="pace-full settings">
            <div className="pace-full-head">
              <span className="micro-label">SETTINGS</span>
              <span className="spacer" />
              <button className="import-btn" onClick={() => setSettingsOpen(false)}>
                CLOSE
              </button>
            </div>
            <section className="settings-section">
              <span className="micro-label">UPDATES</span>
              <label className="settings-row">
                <input
                  type="checkbox"
                  checked={beta}
                  onChange={(e) => {
                    setBeta(e.target.checked)
                    window.api.setPrerelease(e.target.checked)
                  }}
                />
                Beta updates — install pre-release versions
              </label>
              <button className="import-btn" onClick={checkUpdates} disabled={checking}>
                {checking ? 'CHECKING…' : 'CHECK FOR UPDATES'}
              </button>
              {updateMsg && <div className="hint">{updateMsg}</div>}
            </section>
            <section className="settings-section">
              <span className="micro-label">ABOUT</span>
              <p>
                Piety {appVersion && `v${appVersion}`} — a Path of Exile campaign leveling
                companion.
              </p>
              <p>
                <a href="https://github.com/sethryder/piety" target="_blank" rel="noreferrer">
                  github.com/sethryder/piety
                </a>
              </p>
            </section>
          </div>
        ) : paceOpen ? (
          <div className="pace-full">
            <div className="pace-full-head">
              <span className="micro-label">PACE</span>
              <span className="spacer" />
              <button className="import-btn" onClick={() => setPaceOpen(false)}>
                CLOSE
              </button>
            </div>
            <PaceView run={run} pb={pb} history={history} now={now} visits={visits} resetRun={resetRun} />
          </div>
        ) : band ? (
          <BandView {...viewProps} />
        ) : ui.view === 'FOCUS' ? (
          <FocusView {...viewProps} />
        ) : ui.view === 'DENSE' ? (
          <DenseView {...viewProps} />
        ) : ui.view === 'SPLIT' ? (
          <SplitView {...viewProps} mirror={!!ui.mirror} />
        ) : (
          <MixedView {...viewProps} />
        )}
      </main>

      <footer className="footer">
        {tailing ? (
          <span className="log-line">{logLines.at(-1) ?? 'tailing…'}</span>
        ) : (
          <button className="log-line locate" onClick={() => window.api.pickLog()}>
            Client.txt not found — click to locate
          </button>
        )}
        <span className="spacer" />
        {updateVersion && (
          <button className="footer-chip update-chip" onClick={() => window.api.installUpdate()}>
            v{updateVersion} READY — RESTART
          </button>
        )}
        {tree && (
          <span className="footer-chip">
            TREE {tree.title} · {tree.nodeCount}
          </span>
        )}
        {run && chipTime !== null && (
          <button
            className="footer-chip pace-chip"
            title="Open pace panel"
            onClick={() => setPaceOpen((o) => !o)}
          >
            <span
              className="gem-dot"
              style={{
                background:
                  paceDelta === null ? '#8a93a2' : paceDelta <= 0 ? '#7fc98f' : '#e08b7d'
              }}
            />
            A{cross} · {fmt(chipTime)}
            {paceDelta !== null && ` · ${fmt(paceDelta, true)}`}
          </button>
        )}
      </footer>
    </>
  )
}
