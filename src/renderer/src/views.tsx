import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { PobBuild } from '../../shared/pob'
import { COLOR_CODE, levelingSet, stripColors } from '../../shared/pob'
import type { GemPlanEntry } from './gemPlan'
import { actSegment, actStart, bestSegments, fmt, lastCrossing, totalDeaths, type Run } from './pace'
import type { LabDue, Step, ZoneVisit } from './route'
import { levelStatus } from '../../shared/xp'
import { useLogLines } from './logStore'
import { ZoneLayout } from './ZoneLayout'

// lazy: keeps the ~430KB passive-tree JSON out of both windows' startup parse;
// it loads once, on the first render with a build imported
const TreeView = lazy(() => import('./TreeView').then((m) => ({ default: m.TreeView })))

// 1s display clock, ticking only while `active`; components that show run time
// use this locally so the rest of the app doesn't re-render every second
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now()) // catch up immediately on (re)activation
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

// Zone level vs character level; hidden in towns (no monsters, no penalty)
export function LevelChip({
  charLv,
  areaLv,
  town
}: {
  charLv: number | null
  areaLv: number | null
  town: boolean
}) {
  if (charLv === null || areaLv === null || town) return null
  const status = levelStatus(charLv, areaLv)
  const delta = areaLv - charLv
  const title =
    status === 'over'
      ? 'Overleveled for this zone — XP penalty'
      : status === 'under'
        ? 'Zone above your level — dangerous, XP penalty'
        : 'Zone level vs your level'
  return (
    <span className={`act-chip lvl-chip ${status}`} title={title}>
      ZL {areaLv} · {delta >= 0 ? `+${delta}` : delta}
    </span>
  )
}

export type TreeInfo = {
  allocated: Set<string>
  added: string[]
  removed: string[]
  mastery: Record<string, string>
  title: string
  pick: number
  count: number
  auto: boolean
  onPick: (i: number | null) => void
  order: number[]
  focusAsc: boolean
  ascPool: string[]
}

export type ViewProps = {
  visits: ZoneVisit[]
  idx: number
  setIdx: (i: number) => void
  cur: ZoneVisit
  due: GemPlanEntry[]
  labsDue: LabDue[]
  hideLab: (lab: number) => void
  plan: GemPlanEntry[]
  owned: Record<string, boolean>
  toggleOwned: (gemId: string) => void
  gemColor: Record<string, string>
  build: PobBuild | null
  tab: string
  setTab: (t: string) => void
  skillSet: string | null
  setSkillSet: (id: string) => void
  run: Run | null
  pb: Run | null
  history: Run[]
  pausedSince: number | null
  resetRun: () => void
  treeInfo: TreeInfo | null
}

// compass arrows from {dir|deg} route fragments get highlighted
const DIR_ARROWS = /([↑↗→↘↓↙←↖])/
function rich(text: string): React.ReactNode {
  return text
    .split(DIR_ARROWS)
    .map((part, i) =>
      DIR_ARROWS.test(part) ? (
        <span key={i} className="dir-arrow">
          {part}
        </span>
      ) : (
        part
      )
    )
}

export function StepLine({ s }: { s: Step }) {
  return (
    <li>
      <div className="step-line">
        {s.tags.map((t, j) => (
          <span key={j} className={`tag tag-${t}`}>
            {t}
          </span>
        ))}
        <span className={s.done ? 'step-done' : ''}>{s.done && '✓ '}{rich(s.text)}</span>
      </div>
      {s.hints.map((h, j) => (
        <div key={j} className="hint">
          ↳ {rich(h)}
        </div>
      ))}
    </li>
  )
}

function DueBanners({ due, labsDue, hideLab, toggleOwned }: Pick<ViewProps, 'due' | 'labsDue' | 'hideLab' | 'toggleOwned'>) {
  return (
    <>
      {labsDue.map((l) => (
        <button key={`l${l.lab}`} className="gem-banner" title="Mark done" onClick={() => hideLab(l.lab)}>
          <span className="tag tag-TRIAL">LAB</span>
          <b>{l.name} Labyrinth</b>&nbsp;— {l.need}/{l.need} trials, ascend from Aspirants&apos; Plaza
          <span className="banner-x">✕</span>
        </button>
      ))}
      {due.map((g) => (
        <button key={g.gemId} className="gem-banner" onClick={() => toggleOwned(g.gemId)}>
          <span className="gem-dot" style={{ background: g.color }} />
          <b>{g.name}</b>&nbsp;— {g.how}
        </button>
      ))}
    </>
  )
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The in-game search field caps at 50 chars and splits on spaces outside
// quotes, so the whole pattern ships as one quoted group. Gems that don't
// fit are left off and the count shows it (e.g. "4/6").
const SEARCH_MAX = 50

function CopyGemRegex({ gems }: { gems: GemPlanEntry[] }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // " support" adds no selectivity to a substring match, just length
  const names = gems.map((g) => escapeRe(g.name.toLowerCase().replace(/ support$/, '')))
  let regex = ''
  let used = 0
  for (const n of names) {
    const next = regex ? `${regex}|${n}` : n
    if (next.length + 2 > SEARCH_MAX) break
    regex = next
    used++
  }
  if (used === 0) return null
  return (
    <button
      className="copy-regex"
      title="Paste into the vendor's search box"
      onClick={() => {
        clearTimeout(timer.current)
        navigator.clipboard.writeText(`"${regex}"`).then(
          () => setState('ok'),
          () => setState('fail')
        )
        timer.current = window.setTimeout(() => setState('idle'), 1500)
      }}
    >
      {state === 'ok'
        ? 'COPIED'
        : state === 'fail'
          ? 'COPY FAILED'
          : `COPY VENDOR REGEX (${used < names.length ? `${used}/${names.length}` : used})`}
    </button>
  )
}

function GemList({ plan, owned, idx, toggleOwned, due }: Pick<ViewProps, 'plan' | 'owned' | 'idx' | 'toggleOwned' | 'due'>) {
  if (plan.length === 0) return <div className="empty">Import a build to get a shopping list.</div>
  return (
    <div className="gems">
      <CopyGemRegex gems={due.filter((g) => g.vendor)} />
      {plan.map((g) => {
        const status = g.granted
          ? 'GRANTED'
          : owned[g.gemId]
            ? 'OWNED'
            : g.visitIdx <= idx
              ? 'BUY NOW'
              : 'LATER'
        return (
          <button
            key={g.gemId}
            className={`gem-row ${status === 'OWNED' || status === 'GRANTED' ? 'owned' : ''}`}
            onClick={() => !g.granted && toggleOwned(g.gemId)}
          >
            <span className="gem-dot" style={{ background: g.color }} />
            <span className="gem-name">{g.name}</span>
            <span className="gem-how">
              Lv {g.requiredLevel} · {g.how}
            </span>
            <span className={`chip chip-${status.replace(' ', '')}`}>{status}</span>
          </button>
        )
      })}
    </div>
  )
}

function UpNextRows({ visits, idx, setIdx, count, preview }: Pick<ViewProps, 'visits' | 'idx' | 'setIdx'> & { count?: number; preview?: boolean }) {
  const next = visits.slice(idx + 1, count ? idx + 1 + count : undefined)
  return (
    <>
      {next.map((v, i) => (
        <button key={i} className="next-row" onClick={() => setIdx(idx + 1 + i)}>
          <span className="act-tag">A{v.act}</span>
          <span className="next-zone">{v.zone}</span>
          {preview && v.steps[0] && <span className="next-preview">{v.steps[0].text}</span>}
        </button>
      ))}
    </>
  )
}

export function FocusView(p: ViewProps) {
  const [primary, ...rest] = p.cur.steps
  return (
    <div className="focus">
      <span className="micro-label">NOW IN</span>
      <h1 className="focus-zone">{p.cur.zone}</h1>
      {primary && (
        <div className="focus-step">
          {primary.tags.map((t, j) => (
            <span key={j} className={`tag tag-${t}`}>
              {t}
            </span>
          ))}
          <span>{rich(primary.text)}</span>
        </div>
      )}
      {primary?.hints.map((h, j) => (
        <div key={j} className="hint">
          ↳ {rich(h)}
        </div>
      ))}
      {rest.length > 0 && (
        <ul className="steps focus-rest">
          {rest.map((s, i) => (
            <StepLine key={i} s={s} />
          ))}
        </ul>
      )}
      <ZoneLayout areaId={p.cur.areaId} />
      <DueBanners due={p.due} labsDue={p.labsDue} hideLab={p.hideLab} toggleOwned={p.toggleOwned} />
      <div className="then">
        <span className="micro-label">THEN</span>
        <UpNextRows visits={p.visits} idx={p.idx} setIdx={p.setIdx} count={3} />
      </div>
    </div>
  )
}

export function MixedView(p: ViewProps) {
  const actVisits = p.visits.filter((v) => v.act === p.cur.act)
  const actDone = actVisits.indexOf(p.cur)
  const pct = actVisits.length > 1 ? (actDone / (actVisits.length - 1)) * 100 : 0
  return (
    <div className="mixed">
      <div className="act-progress">
        <div className="act-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <section className="zone-card">
        <div className="zone-card-main">
          <span className="micro-label">NOW IN</span>
          <h1>{p.cur.zone}</h1>
          <ul className="steps">
            {p.cur.steps.map((s, i) => (
              <StepLine key={i} s={s} />
            ))}
          </ul>
        </div>
        <ZoneLayout areaId={p.cur.areaId} />
      </section>
      <DueBanners due={p.due} labsDue={p.labsDue} hideLab={p.hideLab} toggleOwned={p.toggleOwned} />
      <section className="up-next scroll">
        <span className="micro-label">UP NEXT</span>
        <UpNextRows visits={p.visits} idx={p.idx} setIdx={p.setIdx} preview />
      </section>
    </div>
  )
}

function SocketGroups({ build, gemColor, skillSet, setSkillSet }: Pick<ViewProps, 'build' | 'gemColor' | 'skillSet' | 'setSkillSet'>) {
  const set = build ? levelingSet(build, skillSet) : null
  if (!build || !set) return <div className="empty">Import a build to see socket groups.</div>
  return (
    <div className="sockets">
      {build.skillSets.length > 1 && (
        <select
          className="set-select"
          value={set.id}
          title="PoB skill set"
          onChange={(e) => setSkillSet(e.target.value)}
        >
          {build.skillSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || `Set ${s.id}`}
            </option>
          ))}
        </select>
      )}
      {set.groups.map((g, i) =>
        g.gems.length === 0 ? (
          <div key={i} className="socket-sep">
            {g.label}
          </div>
        ) : (
          <div key={i} className={`socket-row ${g.enabled ? '' : 'off'}`}>
            <span className="socket-slot">{g.slot || g.label || '—'}</span>
            <span className="socket-gems">
              {g.gems.map((gem, j) => (
                <span key={j} className={`socket-chip ${gem.enabled ? '' : 'off'}`}>
                  <span className="gem-dot" style={{ background: gemColor[gem.gemId] ?? '#c6cdd7' }} />
                  {gem.name}
                </span>
              ))}
            </span>
          </div>
        )
      )}
    </div>
  )
}

function LogPanel() {
  const logLines = useLogLines()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight)
  }, [logLines])
  return (
    <div className="log-panel" ref={ref}>
      {logLines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  )
}

function ZoneSplitRows({ run, pb, visits, act }: { run: Run; pb: Run | null; visits: ZoneVisit[]; act: number }) {
  return (
    <>
      {visits.map((v, i) => ({ v, i })).filter(({ v }) => v.act === act).map(({ v, i }) => {
        const t = run.zones?.[i]
        const pbT = pb?.zones?.[i]
        const d = t !== undefined && pbT !== undefined ? t - pbT : null
        return (
          <tr key={`z${i}`} className="zone-split">
            <td />
            <td className="split-zone-name">{v.zone}</td>
            <td className="split-time">{t !== undefined ? fmt(t) : pbT !== undefined ? fmt(pbT) : '—'}</td>
            <td className={`split-delta ${d === null ? '' : d <= 0 ? 'ahead' : 'behind'}`}>
              {d !== null ? fmt(d, true) : t === undefined && pbT !== undefined ? 'PB' : ''}
            </td>
            <td />
          </tr>
        )
      })}
    </>
  )
}

// font skull glyphs (☠/☠︎) are a lottery at 11px — color emoji on Windows,
// tofu-ish fallbacks elsewhere; a filled silhouette stays crisp everywhere
function Skull() {
  return (
    <svg className="skull" viewBox="0 0 24 24" aria-label="deaths">
      <path
        fillRule="evenodd"
        d="M12 2c-4.7 0-8.5 3.6-8.5 8.2 0 2.6 1.2 4.8 3.1 6.3l.4.3V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3.2l.4-.3c1.9-1.5 3.1-3.7 3.1-6.3C20.5 5.6 16.7 2 12 2Zm-3.2 6.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Zm6.4 0a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4ZM12 13.5l1.4 2.6h-2.8L12 13.5Z"
      />
    </svg>
  )
}

function RunHistory({ history, pb }: { history: Run[]; pb: Run | null }) {
  if (history.length === 0) return null
  return (
    <>
      <span className="micro-label">RUN HISTORY</span>
      <table className="splits">
        <tbody>
          {history.map((h, i) => {
            const d = h !== pb && h.total !== null && pb?.total != null ? h.total - pb.total : null
            return (
              <tr key={i}>
                <td className="split-act">RUN {i + 1}</td>
                <td className="split-date">
                  {new Date(h.start).toLocaleDateString()}
                  {totalDeaths(h) > 0 && <span className="split-deaths"> <Skull />{totalDeaths(h)}</span>}
                </td>
                <td className="split-time">{h.total !== null ? fmt(h.total) : '—'}</td>
                <td className={`split-delta ${h === pb ? 'ahead' : d === null ? '' : d <= 0 ? 'ahead' : 'behind'}`}>
                  {h === pb ? 'PB' : d !== null ? fmt(d, true) : `A${lastCrossing(h)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

export function PaceView({ run, pb, history, pausedSince, visits, resetRun }: Pick<ViewProps, 'run' | 'pb' | 'history' | 'pausedSince' | 'visits' | 'resetRun'>) {
  const [openAct, setOpenAct] = useState<number | null>(null)
  // reset is one accidental click from ending a timed run: ask twice, disarm after 3s
  const [armed, setArmed] = useState(false)
  // while paused the clock reads as of pausedSince; start is rebased on resume
  const paused = pausedSince !== null
  const tick = useNow(run?.total === null && !paused)
  const now = pausedSince ?? tick
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  if (!run)
    return (
      <div className="pace">
        <div className="empty">Run starts when you enter the Twilight Strand.</div>
        <RunHistory history={history} pb={pb} />
      </div>
    )
  const elapsed = run.total ?? now - run.start
  const cross = lastCrossing(run)
  const inAct = elapsed - (actStart(run, cross) ?? 0)
  const delta =
    pb && run.splits[cross] !== undefined && pb.splits[cross] !== undefined
      ? run.splits[cross] - pb.splits[cross]
      : null
  const proj = pb?.total != null ? elapsed + pb.total - (pb.splits[cross] ?? 0) : null
  const best = bestSegments(history)

  return (
    <div className="pace">
      <div className="pace-cards">
        <div className="pace-card">
          <span className="micro-label">
            RUN TIME{paused && ' · PAUSED'}
            {totalDeaths(run) > 0 && <span className="split-deaths"> · <Skull />{totalDeaths(run)}</span>}
          </span>
          <span className="pace-clock">{fmt(elapsed)}</span>
          {delta !== null && (
            <span className={`pace-delta ${delta <= 0 ? 'ahead' : 'behind'}`}>
              {fmt(delta, true)} vs PB
            </span>
          )}
        </div>
        <div className="pace-card">
          <span className="micro-label">PROJ. TO MAPS</span>
          <span className="pace-clock">{proj !== null ? fmt(proj) : '—'}</span>
          {pb?.total != null && <span className="pace-delta">PB {fmt(pb.total)}</span>}
        </div>
      </div>
      <table className="splits">
        <thead>
          <tr>
            <th />
            <th className="split-act">SPLIT</th>
            <th className="split-time">TIME</th>
            <th className="split-delta">Δ PB</th>
            <th className="split-best">BEST</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((act) => {
            const seg = actSegment(run, act)
            const state = seg !== null ? 'done' : act === cross && run.total === null ? 'current' : 'future'
            const pbSeg = pb ? actSegment(pb, act) : null
            const d =
              seg !== null && pbSeg !== null
                ? seg - pbSeg
                : state === 'current' && pbSeg !== null
                  ? inAct - pbSeg
                  : null
            return (
              <Fragment key={act}>
                <tr
                  className={`${state} act-row`}
                  onClick={() => setOpenAct(openAct === act ? null : act)}
                >
                  <td className="split-mark">{state === 'done' ? '✓' : state === 'current' ? '▶' : '·'}</td>
                  <td className="split-act">
                    ACT {act}
                    {(run.deaths?.[act] ?? 0) > 0 && <span className="split-deaths"> <Skull />{run.deaths![act]}</span>}
                  </td>
                  <td className={`split-time ${seg !== null && best[act] !== undefined && seg < best[act] ? 'gold' : ''}`}>
                    {seg !== null ? fmt(seg) : state === 'current' ? fmt(inAct) : pbSeg !== null ? fmt(pbSeg) : '—'}
                  </td>
                  <td className={`split-delta ${d === null ? '' : d <= 0 ? 'ahead' : 'behind'}`}>
                    {d !== null ? fmt(d, true) : state === 'future' && pbSeg !== null ? 'PB' : ''}
                  </td>
                  <td className="split-best">{best[act] !== undefined ? fmt(best[act]) : ''}</td>
                </tr>
                {openAct === act && <ZoneSplitRows run={run} pb={pb} visits={visits} act={act} />}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      <RunHistory history={history} pb={pb} />
      <button
        className="import-btn"
        onClick={() => {
          if (armed) resetRun()
          setArmed(!armed)
        }}
      >
        {armed ? 'CONFIRM RESET' : 'RESET RUN'}
      </button>
    </div>
  )
}

// PoB's ^0-^9 palette (SimpleGraphic); ^7 is default text so it inherits
const CARET_COLORS = ['#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '', '#B3B3B3', '#666666']

// dark colors vanish on the dark panel; blend toward white until bright enough
function visibleColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const min = 120
  if (lum >= min) return hex
  const t = (min - lum) / (255 - lum)
  const mix = (c: number) => Math.round(c + (255 - c) * t)
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`
}

const NOTES_SPLIT = new RegExp(`(${COLOR_CODE.source})`, 'g')

function PobNotes({ text }: { text: string }) {
  let color: string | undefined
  return (
    <pre className="pob-notes">
      {text.split(NOTES_SPLIT).map((part, i) => {
        // split with a capture group: odd indices are the color codes, even are text
        if (i % 2) {
          const hex = part[1] === 'x' ? '#' + part.slice(2) : CARET_COLORS[+part[1]]
          color = hex ? visibleColor(hex) : undefined
          return null
        }
        return part ? (
          <span key={i} style={{ color }}>
            {part}
          </span>
        ) : null
      })}
    </pre>
  )
}

export function DenseView(p: ViewProps) {
  const curRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    curRef.current?.scrollIntoView({ block: 'center' })
  }, [p.idx])
  return (
    <div className="dense">
      <div className="dense-list">
        {p.visits.map((v, i) => {
          const state = i < p.idx ? 'done' : i === p.idx ? 'current' : 'future'
          return (
            <div key={i} ref={i === p.idx ? curRef : undefined} className={`dense-row ${state}`}>
              <button className="dense-zone" onClick={() => p.setIdx(i)}>
                <span className="dense-mark">{state === 'done' ? '✓' : state === 'current' ? '▶' : '·'}</span>
                <span className="act-tag">A{v.act}</span>
                <span>{v.zone}</span>
              </button>
              {state === 'current' && (
                <ul className="steps dense-steps">
                  {v.steps.map((s, j) => (
                    <StepLine key={j} s={s} />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      <div className="tab-strip">
        {['GEMS', 'SOCKETS', 'TREE', 'NOTES', 'LOG', 'PACE'].map((t) => (
          <button key={t} className={`tab ${p.tab === t ? 'active' : ''}`} onClick={() => p.setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        {p.tab === 'GEMS' && <GemList plan={p.plan} owned={p.owned} idx={p.idx} toggleOwned={p.toggleOwned} due={p.due} />}
        {p.tab === 'SOCKETS' && <SocketGroups build={p.build} gemColor={p.gemColor} skillSet={p.skillSet} setSkillSet={p.setSkillSet} />}
        {p.tab === 'TREE' &&
          (p.treeInfo ? (
            <Suspense fallback={null}>
              <TreeView key={p.treeInfo.pick} {...p.treeInfo} />
            </Suspense>
          ) : (
            <div className="empty">
              {p.build
                ? 'Re-run SETUP and re-parse your PoB to enable the tree view.'
                : 'Import a build to see passive tree progression.'}
            </div>
          ))}
        {p.tab === 'NOTES' &&
          (p.build && stripColors(p.build.notes).trim() ? (
            <PobNotes text={p.build.notes} />
          ) : (
            <div className="empty">
              {p.build ? 'This build has no notes. Re-parse your PoB if you added some.' : 'Import a build to see its notes.'}
            </div>
          ))}
        {p.tab === 'LOG' && <LogPanel />}
        {p.tab === 'PACE' && (
          <PaceView
            run={p.run}
            pb={p.pb}
            history={p.history}
            pausedSince={p.pausedSince}
            visits={p.visits}
            resetRun={p.resetRun}
          />
        )}
      </div>
    </div>
  )
}

export function SplitView(p: ViewProps & { mirror: boolean }) {
  return (
    <div className={`split ${p.mirror ? 'mirror' : ''}`}>
      <div className="split-zone">
        <MixedView {...p} />
      </div>
      <div className="split-gems">
        <span className="micro-label">LINKS</span>
        <SocketGroups build={p.build} gemColor={p.gemColor} skillSet={p.skillSet} setSkillSet={p.setSkillSet} />
        <span className="micro-label">GEMS</span>
        <GemList plan={p.plan} owned={p.owned} idx={p.idx} toggleOwned={p.toggleOwned} due={p.due} />
      </div>
      <div className="split-tree">
        {p.treeInfo ? (
          <Suspense fallback={null}>
            <TreeView key={p.treeInfo.pick} {...p.treeInfo} />
          </Suspense>
        ) : (
          <div className="empty">Import a build to see passive tree progression.</div>
        )}
      </div>
    </div>
  )
}

export function BandView(p: ViewProps) {
  return (
    <div className="band">
      <div className="band-col">
        <span className="micro-label">CURRENT ZONE</span>
        <h2 className="band-zone">{p.cur.zone}</h2>
        <ul className="steps band-steps">
          {p.cur.steps.map((s, i) => (
            <StepLine key={i} s={s} />
          ))}
        </ul>
      </div>
      <div className="band-col">
        <span className="micro-label">UP NEXT</span>
        <UpNextRows visits={p.visits} idx={p.idx} setIdx={p.setIdx} count={3} />
      </div>
      <div className="band-col">
        <span className="micro-label">GEMS</span>
        {p.due.length > 0 || p.labsDue.length > 0 ? (
          <DueBanners due={p.due} labsDue={p.labsDue} hideLab={p.hideLab} toggleOwned={p.toggleOwned} />
        ) : (
          <div className="empty">Nothing to buy right now.</div>
        )}
      </div>
    </div>
  )
}
