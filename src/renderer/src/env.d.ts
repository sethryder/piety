/// <reference types="vite/client" />

type LogEvent =
  | { type: 'line'; line: string }
  | { type: 'enter'; zone: string }
  | { type: 'gen'; areaId: string; areaLevel: number; seed: number }
  | { type: 'level'; name: string; cls: string; level: number }

interface Window {
  api: {
    importPob: (text: string) => Promise<import('../../shared/pob').PobBuild>
    listPobBuilds: () => Promise<import('../../main/pobBuilds').BuildFile[]>
    readPobBuild: (path: string) => Promise<import('../../shared/pob').PobBuild>
    watchBuild: (path: string | null) => void
    onBuildUpdated: (cb: (b: import('../../shared/pob').PobBuild) => void) => () => void
    pickLog: () => Promise<string | null>
    initState: () => Promise<{ logPath: string | null; idx: number }>
    onLog: (cb: (e: LogEvent) => void) => () => void
    onLogStatus: (cb: (path: string | null) => void) => () => void
    onUpdateReady: (cb: (version: string) => void) => () => void
    installUpdate: () => void
    toggleMini: () => void
    syncIdx: (idx: number) => void
    onIdxSync: (cb: (idx: number) => void) => () => void
  }
}
