import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LogEvent } from '../main/logtail'
import type { PobBuild } from '../shared/pob'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('api', {
  importPob: (text: string): Promise<PobBuild> => ipcRenderer.invoke('pob-import', text),
  listPobBuilds: () => ipcRenderer.invoke('pob-list'),
  readPobBuild: (path: string): Promise<PobBuild> => ipcRenderer.invoke('pob-read', path),
  watchBuild: (path: string | null) => ipcRenderer.send('watch-build', path),
  onBuildUpdated: (cb: (b: PobBuild) => void) => on('build-updated', cb),
  pickLog: (): Promise<string | null> => ipcRenderer.invoke('pick-log'),
  initState: (): Promise<{ logPath: string | null; idx: number }> =>
    ipcRenderer.invoke('init-state'),
  onLog: (cb: (e: LogEvent) => void) => on('log-event', cb),
  onLogStatus: (cb: (path: string | null) => void) => on('log-status', cb),
  onUpdateReady: (cb: (version: string) => void) => on('update-ready', cb),
  installUpdate: () => ipcRenderer.send('install-update'),
  toggleMini: () => ipcRenderer.send('toggle-mini'),
  syncIdx: (idx: number) => ipcRenderer.send('sync-idx', idx),
  onIdxSync: (cb: (idx: number) => void) => on('idx-sync', cb)
})
