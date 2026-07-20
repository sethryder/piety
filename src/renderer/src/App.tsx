import { useEffect, useMemo, useRef, useState } from 'react'
import { banditFlags, classMatches, type PobBuild } from '../../shared/pob'
import { activeSpecIdx, autoAssign, treeDelta } from '../../shared/trees'
import { advance, advanceById, dueTrials, labNeed } from './route'
import { buildRoute } from './routeData'
import { planGems } from './gemPlan'
import { gemDb } from './gemData'
import { levelingSet } from '../../shared/pob'
import { actSegment, actStart, finishRun, fmt, lastCrossing, pbOf, rebaseStart, recordActEntry, recordDeath, recordZoneEntry, startRun, worthStashing, type Run } from './pace'
import { BandView, DenseView, FocusView, LevelChip, MixedView, PaceView, SplitView, type ViewProps } from './views'
import { Wizard, type WizardResult } from './wizard'
import { claimProfile, lastChar, loadProfile, saveProfile } from './profiles'

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
  // owned gems + route position live in per-character profiles (see profiles.ts)
  const [owned, setOwned] = useState<Record<string, boolean>>(() => loadProfile().owned)
  const [ui, setUiState] = useState<{ view: View; mirror?: boolean }>(() =>
    load('ui', { view: 'SPLIT' as View, mirror: false })
  )
  // short window (e.g. FancyZones band on a portrait monitor) forces the compact band layout
  const [shortWindow, setShortWindow] = useState(() => window.innerHeight < 520)
  const [idx, setIdx] = useState(() => loadProfile().idx)
  const [trials, setTrials] = useState(() => loadProfile().trials ?? 0)
  const [hiddenTrials, setHiddenTrials] = useState<number[]>(() => loadProfile().hiddenTrials ?? [])
  const [char, setChar] = useState<{ name: string; level: number; cls: string } | null>(null)
  const [areaLevel, setAreaLevel] = useState<number | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [logPath, setLogPath] = useState<string | null>(null)
  const [tab, setTab] = useState('GEMS')
  const [leagueStart, setLeagueStart] = useState<boolean>(() => load('league-start', true))
  const [library, setLibrary] = useState<boolean>(() => load('library', true))
  const [treeAssign, setTreeAssign] = useState<(number | null)[]>(() => load('tree-assign', []))
  const [banditOverride, setBanditOverride] = useState<string | null>(() =>
    load('bandit-override', null)
  )
  const [run, setRun] = useState<Run | null>(() => load('pace-run', null))
  const [history, setHistory] = useState<Run[]>(() => load('pace-history', []))
  const [now, setNow] = useState(() => Date.now())
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [setupDone, setSetupDone] = useState(() => load('setup-done', false))
  const [wizardOpen, setWizardOpen] = useState(
    () => load<PobBuild | null>('pob-build', null) === null && !load('setup-done', false)
  )
  const [paceOpen, setPaceOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const [beta, setBeta] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [pobSource, setPobSource] = useState<string | null>(() => load('pob-source', null))
  const [accent, setAccent] = useState<string>(() => load('accent', '#d7a94e'))
  const [autoView, setAutoView] = useState<boolean>(() => load('auto-view', false))
  const [miniAutoFit, setMiniAutoFit] = useState<boolean>(() => load('mini-autofit', true))
  const [miniDue, setMiniDue] = useState<boolean>(() => load('mini-due', true))
  // auto view: FOCUS while in the wilderness, the user's chosen view in town.
  // Transient — a manual view click overrides until the next zone change.
  const [autoFocus, setAutoFocus] = useState(false)

  function pickAccent(c: string) {
    setAccent(save('accent', c))
    // storage events only fire in other windows; apply here directly
    document.documentElement.style.setProperty('--accent', c)
  }

  useEffect(() => window.api.onUpdateReady(setUpdateVersion), [])

  useEffect(() => {
    window.api.initState().then((s) => {
      setLogPath(s.logPath)
      setAppVersion(s.version)
      setBeta(s.allowPrerelease)
      onPoeStatus(s.poeRunning, Date.now())
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep the mini overlay window on the same route position
  useEffect(() => window.api.syncIdx(idx), [idx])
  // and accept steps made from the mini's arrows
  useEffect(
    () =>
      window.api.onIdxSync((i) => {
        idxRef.current = i
        setIdx(i)
      }),
    []
  )
  // apply banner actions clicked in the mini; persistence echoes back to it
  useEffect(
    () =>
      window.api.onMiniAction((a) => {
        if (a.kind === 'toggle-owned') setOwned((o) => ({ ...o, [a.gemId]: !o[a.gemId] }))
        else if (a.kind === 'hide-trial') setHiddenTrials((h) => [...h, a.ordinal])
      }),
    []
  )

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
        ...(library ? ['LIBRARY'] : []),
        ...banditFlags(banditOverride ?? build?.bandit ?? null)
      ]),
    [build, leagueStart, library, banditOverride]
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
  const charRef = useRef(lastChar())

  // persist the active profile on every change; char switches redirect charRef first
  useEffect(() => {
    saveProfile(charRef.current, { owned, idx, trials, hiddenTrials })
  }, [owned, idx, trials, hiddenTrials])

  // Auto-pause: while the game is closed the clock freezes at pausedSince, and
  // on resume the run's start shifts forward by the gap, so every split
  // computed from (now - start) stays correct with no model change.
  // ponytail: the gap while the app itself is closed isn't credited as pause;
  // persist pausedSince in the run if that matters
  const [pausedSince, setPausedSinceState] = useState<number | null>(null)
  const pausedRef = useRef<number | null>(null)
  function setPausedSince(v: number | null) {
    pausedRef.current = v
    setPausedSinceState(v)
  }

  function onPoeStatus(running: boolean, nowMs: number) {
    if (!running) {
      if (pausedRef.current === null && runRef.current && runRef.current.total === null)
        setPausedSince(nowMs)
    } else if (pausedRef.current !== null) {
      const r = runRef.current
      if (r && r.total === null) {
        const shifted = rebaseStart(r, pausedRef.current, nowMs)
        runRef.current = shifted
        setRun(save('pace-run', shifted))
      }
      setPausedSince(null)
    }
  }

  useEffect(() => window.api.onPoeStatus((v) => onPoeStatus(v, Date.now())), [])

  // manual zone jumps must update the ref too, or the next log event advances
  // from a stale position
  function jumpTo(i: number) {
    idxRef.current = i
    setIdx(i)
  }

  // arrow keys step the route; the header ◀ ▶ targets are small for mid-game use
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (wizardOpen || settingsOpen) return
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === 'ArrowLeft' && idxRef.current > 0) {
        e.preventDefault()
        jumpTo(idxRef.current - 1)
      } else if (e.key === 'ArrowRight' && idxRef.current < visits.length - 1) {
        e.preventDefault()
        jumpTo(idxRef.current + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, wizardOpen, settingsOpen])

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
      // any live log line proves the game is up — resume before the next poll
      onPoeStatus(true, Date.now())
      if (e.type === 'line') {
        setLogLines((l) => [...l.slice(-99), e.line])
      } else if (e.type === 'level') {
        if (e.name !== charRef.current) {
          const prof = claimProfile(e.name, idxRef.current)
          charRef.current = e.name
          setOwned(prof.owned)
          setTrials(prof.trials ?? 0)
          setHiddenTrials(prof.hiddenTrials ?? [])
          jumpTo(prof.idx)
        }
        setChar({ name: e.name, level: e.level, cls: e.cls })
      } else if (e.type === 'trial') {
        setTrials((t) => t + 1)
      } else if (e.type === 'slain') {
        // only our character's deaths count; the line also fires for party members
        const r = runRef.current
        if (r && r.total === null && e.name === charRef.current) {
          runRef.current = recordDeath(r, lastCrossing(r))
          setRun(save('pace-run', runRef.current))
        }
      } else if (e.type === 'gen' || e.type === 'enter') {
        // 'gen' (area id, language-independent, new instances only) is the primary
        // signal; 'enter' (localized name, every entry) is the fallback and a no-op
        // when 'gen' already moved us
        if (e.type === 'gen') setAreaLevel(e.areaLevel)
        const ni =
          e.type === 'gen'
            ? advanceById(visits, idxRef.current, e.areaId)
            : advance(visits, idxRef.current, e.zone)
        const nowMs = Date.now()
        idxRef.current = ni
        setIdx(ni)

        let r = runRef.current
        // a brand-new character always generates a fresh Twilight Strand instance,
        // so restart only on 'gen' by area id — act 6's Twilight Strand shares the
        // display name, and a name-based check would reset the run there
        const atStart = e.type === 'gen' && e.areaId === visits[0].areaId
        if (atStart) {
          stashPartial(r)
          r = startRun(nowMs)
          // a fresh Twilight Strand = new character: park progress under the
          // pending '' profile until the first level-up line names them
          if (charRef.current !== '') {
            charRef.current = save('last-char', '')
            setOwned({})
            setTrials(0)
            setHiddenTrials([])
            setChar(null)
          }
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

  // tick completed trials and show progress toward the next lab (6/9/12 trials)
  const shownVisits = useMemo(
    () =>
      visits.map((v) => ({
        ...v,
        steps: v.steps.map((s) => {
          if (!s.trial) return s
          const need = labNeed(s.trial)
          return { ...s, done: s.trial <= trials, text: `${s.text} (${Math.min(trials, need)}/${need})` }
        })
      })),
    [visits, trials]
  )

  const cur = shownVisits[Math.min(idx, visits.length - 1)]

  // standing banners (like due gems) so labs can happen at natural stopping points
  const trialsDue = useMemo(
    () => dueTrials(visits, idx, trials, hiddenTrials),
    [visits, trials, idx, hiddenTrials]
  )

  useEffect(() => {
    setAutoFocus(autoView && !cur.areaId.endsWith('_town'))
  }, [autoView, cur])
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
    setOwned((o) => ({ ...o, [gemId]: !o[gemId] }))
  }

  // keep partial runs (act 2+ reached): their segments feed best-act comparisons
  function stashPartial(r: Run | null) {
    if (worthStashing(r)) {
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
    setSetupDone(save('setup-done', true))
    // guide-only: SPLIT is mostly empty panels without a build, so drop to MIXED
    if (r.build === null && ui.view === 'SPLIT') setUi({ ...ui, view: 'MIXED' })
    setBuild(save('pob-build', r.build))
    setTreeAssign(save('tree-assign', r.treeAssign))
    setLeagueStart(save('league-start', r.leagueStart))
    setLibrary(save('library', r.library))
    setBanditOverride(save('bandit-override', r.bandit))
    setPobSource(save('pob-source', r.sourcePath))
    window.api.watchBuild(r.sourcePath)
    setWizardOpen(false)
  }

  // while paused the clock reads as of pausedSince; start is rebased on resume
  const clockNow = pausedSince ?? now
  const elapsed = run ? (run.total ?? clockNow - run.start) : null
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
    visits: shownVisits,
    idx,
    setIdx: jumpTo,
    cur,
    due,
    trialsDue,
    hideTrial: (ordinal: number) => setHiddenTrials((h) => [...h, ordinal]),
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
    now: clockNow,
    paused: pausedSince !== null,
    resetRun,
    treeInfo
  }
  const band = shortWindow
  const tailing = logPath !== null
  const view: View = autoFocus ? 'FOCUS' : ui.view

  return (
    <>
      <header className="header">
        <span className={`tail-dot ${tailing ? '' : 'dead'}`} />
        <span className="char">
          {char ? `${char.name} · Lv ${char.level}` : 'No character'}
        </span>
        {char && build && !classMatches(char.cls, build) && (
          <span
            className="act-chip class-warn"
            title={`This character is a ${char.cls}, but the imported PoB build is for a ${build.className}.`}
          >
            ⚠ {build.className.toUpperCase()} BUILD
          </span>
        )}
        <span className="act-chip">ACT {cur.act}</span>
        <LevelChip
          charLv={char?.level ?? null}
          areaLv={areaLevel}
          town={cur.areaId.endsWith('_town')}
        />
        {run && runNo > 0 && <span className="act-chip run-chip">RUN {runNo}</span>}
        <span className="step-btns">
          <button
            className="import-btn"
            title="Step route back"
            disabled={idx === 0}
            onClick={() => jumpTo(idx - 1)}
          >
            ◀
          </button>
          <button
            className="import-btn"
            title="Step route forward"
            disabled={idx >= visits.length - 1}
            onClick={() => jumpTo(idx + 1)}
          >
            ▶
          </button>
        </span>
        <span className="spacer" />
        <div className={`view-toggle ${band ? 'dimmed' : ''}`}>
          {(['FOCUS', 'MIXED', 'DENSE', 'SPLIT'] as const).map((v) => (
            <button
              key={v}
              className={view === v ? 'active' : ''}
              onClick={() => {
                setAutoFocus(false)
                setUi({ ...ui, view: v })
              }}
            >
              {v}
            </button>
          ))}
          {view === 'SPLIT' && !band && (
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
        <button className="import-btn cog-btn" title="Settings" onClick={() => setSettingsOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      <main className="main">
        {wizardOpen ? (
          <Wizard
            initial={{
              build,
              treeAssign: assign,
              leagueStart,
              library,
              bandit: banditOverride,
              sourcePath: pobSource
            }}
            logPath={logPath}
            lastLine={logLines.at(-1) ?? ''}
            canClose={build !== null || setupDone}
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
              <span className="micro-label">ACCENT</span>
              <div className="accent-row">
                {['#d7a94e', '#7aa7d9', '#8fbf7a', '#c39ad9'].map((c) => (
                  <button
                    key={c}
                    className={`accent-swatch ${accent === c ? 'active' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => pickAccent(c)}
                  />
                ))}
                <input
                  type="color"
                  value={accent}
                  title="Custom color"
                  onChange={(e) => pickAccent(e.target.value)}
                />
              </div>
            </section>
            <section className="settings-section">
              <span className="micro-label">VIEW</span>
              <label className="settings-row">
                <input
                  type="checkbox"
                  checked={autoView}
                  onChange={(e) => setAutoView(save('auto-view', e.target.checked))}
                />
                Auto view — FOCUS in the wilderness, your chosen view in town
              </label>
              <label className="settings-row">
                <input
                  type="checkbox"
                  checked={miniAutoFit}
                  onChange={(e) => setMiniAutoFit(save('mini-autofit', e.target.checked))}
                />
                Mini auto-height — the mini window resizes to fit each step
              </label>
              <label className="settings-row">
                <input
                  type="checkbox"
                  checked={miniDue}
                  onChange={(e) => setMiniDue(save('mini-due', e.target.checked))}
                />
                Mini reminders — show gem and trial banners in the mini window
              </label>
            </section>
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
            <PaceView
              run={run}
              pb={pb}
              history={history}
              now={clockNow}
              paused={pausedSince !== null}
              visits={visits}
              resetRun={resetRun}
            />
          </div>
        ) : band ? (
          <BandView {...viewProps} />
        ) : view === 'FOCUS' ? (
          <FocusView {...viewProps} />
        ) : view === 'DENSE' ? (
          <DenseView {...viewProps} />
        ) : view === 'SPLIT' ? (
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
                  pausedSince !== null || paceDelta === null
                    ? '#8a93a2'
                    : paceDelta <= 0
                      ? 'var(--positive)'
                      : 'var(--negative)'
              }}
            />
            A{cross} · {fmt(chipTime)}
            {paceDelta !== null && ` · ${fmt(paceDelta, true)}`}
            {pausedSince !== null && ' · PAUSED'}
          </button>
        )}
      </footer>
    </>
  )
}
