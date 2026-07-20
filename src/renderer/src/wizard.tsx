import { useEffect, useMemo, useState } from 'react'
import type { BuildFile } from '../../main/pobBuilds'
import { banditFlags, levelingSet, type PobBuild } from '../../shared/pob'
import { autoAssign, BREAKPOINTS } from '../../shared/trees'
import { buildRoute } from './routeData'

export type WizardResult = {
  build: PobBuild | null // null = guide-only, no PoB import
  treeAssign: (number | null)[]
  leagueStart: boolean
  library: boolean // Act 3 Library detour: unlocks Siosa's gem shop
  bandit: string | null // override; null = use the PoB's choice
  sourcePath: string | null // linked local PoB file; null = pasted code
}

const STEPS = ['LOG', 'IMPORT', 'TREES', 'ROUTE', 'DONE']
const BANDITS = ['None', 'Alira', 'Kraityn', 'Oak']

export function Wizard(props: {
  initial: Omit<WizardResult, 'build'> & { build: PobBuild | null }
  logPath: string | null
  lastLine: string
  canClose: boolean
  onClose: () => void
  onFinish: (r: WizardResult) => void
}) {
  const [step, setStep] = useState(0)
  const [pobText, setPobText] = useState('')
  const [parsed, setParsed] = useState<PobBuild | null>(props.initial.build)
  const [error, setError] = useState('')
  const [assign, setAssign] = useState<(number | null)[]>(() =>
    props.initial.build && props.initial.treeAssign.length === props.initial.build.specs.length
      ? props.initial.treeAssign
      : (props.initial.build?.specs ?? []).map((s) => autoAssign(s.title))
  )
  const [leagueStart, setLeagueStart] = useState(props.initial.leagueStart)
  const [library, setLibrary] = useState(props.initial.library)
  const [bandit, setBandit] = useState<string | null>(props.initial.bandit)
  const [buildFiles, setBuildFiles] = useState<BuildFile[]>([])
  const [sourcePath, setSourcePath] = useState<string | null>(props.initial.sourcePath)

  useEffect(() => {
    window.api
      .listPobBuilds()
      .then(setBuildFiles)
      .catch(() => setBuildFiles([]))
  }, [])

  const gates = [props.logPath !== null, parsed !== null, true, true, true]

  async function parse() {
    setError('')
    try {
      const b = await window.api.importPob(pobText)
      setParsed(b)
      setAssign(b.specs.map((s) => autoAssign(s.title)))
      setSourcePath(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function pickFile(f: BuildFile) {
    setError('')
    try {
      const b = await window.api.readPobBuild(f.path)
      setParsed(b)
      setAssign(b.specs.map((s) => autoAssign(s.title)))
      setSourcePath(f.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const routeCount = useMemo(
    () =>
      buildRoute([
        ...(leagueStart ? ['LEAGUE_START'] : []),
        ...(library ? ['LIBRARY'] : []),
        ...banditFlags(bandit ?? parsed?.bandit ?? null)
      ]).length,
    [leagueStart, library, bandit, parsed]
  )

  const set = parsed ? levelingSet(parsed) : null
  const gemNames = set ? [...new Set(set.groups.flatMap((g) => g.gems.map((x) => x.name)))] : []

  function cycle(i: number, dir: 1 | -1) {
    // cycle through: unassigned (null), then each breakpoint
    setAssign((a) => {
      const cur = a[i] === null ? -1 : a[i]!
      const n = BREAKPOINTS.length + 1
      const next = (cur + 1 + dir + n) % n // shift null to 0
      return a.map((v, j) => (j === i ? (next === 0 ? null : next - 1) : v))
    })
  }

  return (
    <div className="wizard">
      <div className="wizard-head">
        {STEPS.map((s, i) => (
          <span key={s} className={`wstep ${i < step ? 'done' : i === step ? 'current' : ''}`}>
            <span className="wdot">{i < step ? '✓' : i + 1}</span>
            {s}
          </span>
        ))}
        <span className="spacer" />
        {props.canClose && (
          <button className="import-btn" onClick={props.onClose}>
            ✕
          </button>
        )}
      </div>

      <div className="wizard-body">
        {step === 0 && (
          <div className="wizard-step">
            <span className="micro-label">CLIENT.TXT — POSITION TRACKING</span>
            <div className={`wchip ${props.logPath ? 'good' : 'bad'}`}>
              {props.logPath ? 'FOUND' : 'NOT FOUND'}
            </div>
            {props.logPath && <div className="wpath">{props.logPath}</div>}
            {props.logPath && props.lastLine && <div className="wlast">{props.lastLine}</div>}
            {/* once the log is found the real CTA is NEXT; browse drops to secondary */}
            <button
              className={props.logPath ? 'import-btn' : 'primary'}
              onClick={() => window.api.pickLog()}
            >
              BROWSE…
            </button>
            {!props.logPath && (
              <div className="whint">
                Point me at Path of Exile&apos;s logs\Client.txt — reading it is how zone tracking
                works. Read-only, no game files touched.
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="wizard-step">
            {buildFiles.length > 0 && (
              <>
                <span className="micro-label">YOUR PATH OF BUILDING BUILDS</span>
                <div className="wbuilds">
                  {buildFiles.map((f) => (
                    <button
                      key={f.path}
                      className={`wbuild-row ${sourcePath === f.path ? 'selected' : ''}`}
                      onClick={() => pickFile(f)}
                    >
                      <span className="wbuild-name">{f.name}</span>
                      <span className="wbuild-date">
                        {new Date(f.mtime).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
                {sourcePath && (
                  <span className="wchip good">
                    linked — updates whenever you save in Path of Building
                  </span>
                )}
                <span className="micro-label">OR PASTE AN EXPORT</span>
              </>
            )}
            {buildFiles.length === 0 && (
              <span className="micro-label">PATH OF BUILDING IMPORT</span>
            )}
            <textarea
              value={pobText}
              onChange={(e) => setPobText(e.target.value)}
              placeholder="Paste a PoB export code or pobb.in link"
              rows={5}
            />
            <div className="import-actions">
              <button className="primary" onClick={parse} disabled={!pobText.trim()}>
                PARSE
              </button>
              {!parsed && (
                <button className="import-btn" onClick={() => setStep(3)}>
                  SKIP — GUIDE ONLY
                </button>
              )}
            </div>
            {!parsed && (
              <div className="whint">
                No build? Skip this and use just the zone guide and pace timer. You can import
                one later from SETUP.
              </div>
            )}
            {error && <div className="import-error">{error}</div>}
            {parsed && (
              <div className="wcard">
                <b>
                  {parsed.className} · {parsed.ascendancy}
                </b>
                <div className="wcard-line">
                  Bandit: {parsed.bandit ?? 'Kill all'} · {gemNames.length} gems ·{' '}
                  {parsed.specs.length} tree specs
                </div>
                <div className="wchips">
                  {gemNames.slice(0, 14).map((g) => (
                    <span key={g} className="socket-chip">
                      {g}
                    </span>
                  ))}
                  {gemNames.length > 14 && <span className="whint">+{gemNames.length - 14} more</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && parsed && (
          <div className="wizard-step">
            <span className="micro-label">TREE SPECS → BREAKPOINTS</span>
            {parsed.specs.map((s, i) => {
              const auto = autoAssign(s.title)
              return (
                <div key={i} className="wtree-row">
                  <span className="wtree-name">{s.title || `Spec ${i + 1}`}</span>
                  <span className="wtree-nodes">{s.nodeCount} nodes</span>
                  {assign[i] === null ? (
                    <span className="wchip warn">set manually</span>
                  ) : assign[i] === auto ? (
                    <span className="wchip good">auto-matched</span>
                  ) : (
                    <span className="wchip">manual</span>
                  )}
                  <span className="wpicker">
                    <button onClick={() => cycle(i, -1)}>◀</button>
                    <span>{assign[i] === null ? '—' : BREAKPOINTS[assign[i]!]}</span>
                    <button onClick={() => cycle(i, 1)}>▶</button>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {step === 3 && (
          <div className="wizard-step">
            <span className="micro-label">ROUTE OPTIONS</span>
            <div className="wtoggle">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  className={leagueStart === v ? 'active' : ''}
                  onClick={() => setLeagueStart(v)}
                >
                  {v ? 'LEAGUE START' : 'HAS TWINK GEAR'}
                </button>
              ))}
            </div>
            <label className="wfield">
              <input
                type="checkbox"
                checked={library}
                onChange={(e) => setLibrary(e.target.checked)}
              />
              Act 3 Library detour — unlocks Siosa, who sells nearly every gem
            </label>
            <label className="wfield">
              Bandit
              <select
                value={bandit ?? ''}
                onChange={(e) => setBandit(e.target.value === '' ? null : e.target.value)}
              >
                <option value="">
                  {parsed ? `From PoB (${parsed.bandit ?? 'Kill all'})` : 'Kill all (default)'}
                </option>
                {BANDITS.map((b) => (
                  <option key={b} value={b}>
                    {b === 'None' ? 'Kill all' : `Help ${b}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="whint">
              {routeCount} zone visits · Acts 1–10 ·{' '}
              {leagueStart ? 'league-start detours included' : 'twink shortcuts'}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="wizard-step wizard-done">
            <span className="micro-label">READY</span>
            {/* canClose = re-running setup: tracking continues, don't imply a restart */}
            {props.canClose ? (
              <>
                <h1>All set, exile.</h1>
                <div className="whint">Changes apply as soon as you finish.</div>
              </>
            ) : (
              <>
                <h1>Waiting for you to enter the Twilight Strand, exile.</h1>
                <div className="whint">Tracking starts on your first zone line.</div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="wizard-foot">
        {step > 0 && (
          <button
            className="import-btn"
            onClick={() => setStep(step === 3 && !parsed ? 1 : step - 1)}
          >
            BACK
          </button>
        )}
        <span className="spacer" />
        {step < STEPS.length - 1 ? (
          <button
            className={`primary ${gates[step] ? '' : 'gated'}`}
            onClick={() => gates[step] && setStep(step + 1)}
          >
            NEXT
          </button>
        ) : (
          <button
            className="primary"
            onClick={() =>
              props.onFinish({
                build: parsed,
                treeAssign: assign,
                leagueStart,
                library,
                bandit,
                sourcePath
              })
            }
          >
            FINISH
          </button>
        )}
      </div>
    </div>
  )
}
