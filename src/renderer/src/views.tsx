import { useEffect, useRef } from 'react'
import type { PobBuild } from '../../shared/pob'
import { levelingSet } from '../../shared/pob'
import type { GemPlanEntry } from './gemPlan'
import { actEnd, fmt, lastCrossing, type Run } from './pace'
import type { Step, ZoneVisit } from './route'
import { TreeView } from './TreeView'
import { ZoneLayout } from './ZoneLayout'

export type TreeInfo = {
  allocated: Set<string>
  added: string[]
  removed: string[]
  title: string
}

export type ViewProps = {
  visits: ZoneVisit[]
  idx: number
  setIdx: (i: number) => void
  cur: ZoneVisit
  due: GemPlanEntry[]
  plan: GemPlanEntry[]
  owned: Record<string, boolean>
  toggleOwned: (gemId: string) => void
  gemColor: Record<string, string>
  logLines: string[]
  build: PobBuild | null
  tab: string
  setTab: (t: string) => void
  run: Run | null
  pb: Run | null
  now: number
  resetRun: () => void
  treeInfo: TreeInfo | null
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
        <span>{s.text}</span>
      </div>
      {s.hints.map((h, j) => (
        <div key={j} className="hint">
          ↳ {h}
        </div>
      ))}
    </li>
  )
}

function DueBanners({ due, toggleOwned }: Pick<ViewProps, 'due' | 'toggleOwned'>) {
  return (
    <>
      {due.map((g) => (
        <button key={g.gemId} className="gem-banner" onClick={() => toggleOwned(g.gemId)}>
          <span className="gem-dot" style={{ background: g.color }} />
          <b>{g.name}</b>&nbsp;— {g.how}
        </button>
      ))}
    </>
  )
}

function GemList({ plan, owned, idx, toggleOwned }: Pick<ViewProps, 'plan' | 'owned' | 'idx' | 'toggleOwned'>) {
  if (plan.length === 0) return <div className="empty">Import a build to get a shopping list.</div>
  return (
    <div className="gems">
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
  const primary = p.cur.steps[0]
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
          <span>{primary.text}</span>
        </div>
      )}
      {primary?.hints[0] && <div className="hint">↳ {primary.hints[0]}</div>}
      <DueBanners due={p.due} toggleOwned={p.toggleOwned} />
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
        <span className="micro-label">NOW IN</span>
        <h1>{p.cur.zone}</h1>
        <ZoneLayout areaId={p.cur.areaId} />
        <ul className="steps">
          {p.cur.steps.map((s, i) => (
            <StepLine key={i} s={s} />
          ))}
        </ul>
      </section>
      <DueBanners due={p.due} toggleOwned={p.toggleOwned} />
      <section className="up-next scroll">
        <span className="micro-label">UP NEXT</span>
        <UpNextRows visits={p.visits} idx={p.idx} setIdx={p.setIdx} preview />
      </section>
    </div>
  )
}

function SocketGroups({ build, gemColor }: Pick<ViewProps, 'build' | 'gemColor'>) {
  const set = build ? levelingSet(build) : null
  if (!set) return <div className="empty">Import a build to see socket groups.</div>
  return (
    <div className="sockets">
      {set.groups.map((g, i) => (
        <div key={i} className="socket-row">
          <span className="socket-slot">{g.slot || g.label || '—'}</span>
          <span className="socket-gems">
            {g.gems.map((gem, j) => (
              <span key={j} className="socket-chip">
                <span className="gem-dot" style={{ background: gemColor[gem.gemId] ?? '#c6cdd7' }} />
                {gem.name}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

function LogPanel({ logLines }: Pick<ViewProps, 'logLines'>) {
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

export function PaceView({ run, pb, now, cur, resetRun }: Pick<ViewProps, 'run' | 'pb' | 'now' | 'cur' | 'resetRun'>) {
  if (!run) return <div className="empty">Run starts when you enter the Twilight Strand.</div>
  const elapsed = run.total ?? now - run.start
  const cross = lastCrossing(run)
  const delta =
    pb && run.splits[cross] !== undefined && pb.splits[cross] !== undefined
      ? run.splits[cross] - pb.splits[cross]
      : null
  const proj = pb?.total != null ? elapsed + pb.total - (pb.splits[cross] ?? 0) : null

  return (
    <div className="pace">
      <div className="pace-cards">
        <div className="pace-card">
          <span className="micro-label">RUN TIME</span>
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
        <tbody>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((act) => {
            const end = actEnd(run, act)
            const state = end !== null ? 'done' : act === cur.act && !run.total ? 'current' : 'future'
            const pbEnd = pb ? actEnd(pb, act) : null
            const d = end !== null && pbEnd !== null ? end - pbEnd : null
            return (
              <tr key={act} className={state}>
                <td className="split-mark">{state === 'done' ? '✓' : state === 'current' ? '▶' : '·'}</td>
                <td className="split-act">ACT {act}</td>
                <td className="split-time">
                  {end !== null ? fmt(end) : state === 'current' ? fmt(elapsed) : pbEnd !== null ? fmt(pbEnd) : '—'}
                </td>
                <td className={`split-delta ${d === null ? '' : d <= 0 ? 'ahead' : 'behind'}`}>
                  {d !== null ? fmt(d, true) : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button className="import-btn" onClick={resetRun}>
        RESET RUN
      </button>
    </div>
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
        {['GEMS', 'SOCKETS', 'TREE', 'CLIENT.LOG', 'PACE'].map((t) => (
          <button key={t} className={`tab ${p.tab === t ? 'active' : ''}`} onClick={() => p.setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="tab-panel">
        {p.tab === 'GEMS' && <GemList plan={p.plan} owned={p.owned} idx={p.idx} toggleOwned={p.toggleOwned} />}
        {p.tab === 'SOCKETS' && <SocketGroups build={p.build} gemColor={p.gemColor} />}
        {p.tab === 'TREE' &&
          (p.treeInfo ? (
            <TreeView {...p.treeInfo} />
          ) : (
            <div className="empty">
              {p.build
                ? 'Re-run SETUP and re-parse your PoB to enable the tree view.'
                : 'Import a build to see passive tree progression.'}
            </div>
          ))}
        {p.tab === 'CLIENT.LOG' && <LogPanel logLines={p.logLines} />}
        {p.tab === 'PACE' && <PaceView run={p.run} pb={p.pb} now={p.now} cur={p.cur} resetRun={p.resetRun} />}
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
        <SocketGroups build={p.build} gemColor={p.gemColor} />
        <span className="micro-label">GEMS</span>
        <GemList plan={p.plan} owned={p.owned} idx={p.idx} toggleOwned={p.toggleOwned} />
      </div>
      <div className="split-tree">
        {p.treeInfo ? (
          <TreeView {...p.treeInfo} />
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
        {p.due.length > 0 ? (
          <DueBanners due={p.due} toggleOwned={p.toggleOwned} />
        ) : (
          <div className="empty">Nothing to buy right now.</div>
        )}
      </div>
    </div>
  )
}
