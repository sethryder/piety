import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { exec } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findClientTxt, tailLog } from './logtail'
import { decodePobCode } from './pob'
import { listBuildFiles } from './pobBuilds'
import { parsePob } from '../shared/pob'

const configPath = () => join(app.getPath('userData'), 'config.json')

function loadConfig(): {
  clientTxt?: string
  miniBounds?: Electron.Rectangle
  allowPrerelease?: boolean
} {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

function patchConfig(patch: object): void {
  try {
    writeFileSync(configPath(), JSON.stringify({ ...loadConfig(), ...patch }))
  } catch {
    // config write failure is non-fatal
  }
}

const broadcast = (channel: string, ...args: unknown[]): void =>
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, ...args))

let currentLogPath: string | null = null
let lastIdx = 0
let stopTail: (() => void) | null = null

function startTail(path: string | null): void {
  stopTail?.()
  stopTail = null
  currentLogPath = path && existsSync(path) ? path : null
  if (currentLogPath) stopTail = tailLog(currentLogPath, (e) => broadcast('log-event', e))
  broadcast('log-status', currentLogPath)
}

// Game liveness: OS process listing only — no game memory, no injection, no
// input. Covers PathOfExile.exe / _x64 / Steam / _KG, same names under Proton.
const WSL_TASKLIST = '/mnt/c/Windows/System32/tasklist.exe'
const POE_CMD =
  process.platform === 'win32'
    ? 'tasklist /FI "IMAGENAME eq PathOfExile*" /NH'
    : existsSync(WSL_TASKLIST) // WSL: the game runs on the Windows host
      ? `${WSL_TASKLIST} /FI "IMAGENAME eq PathOfExile*" /NH`
      : 'pgrep -fa PathOfExile'

let poeRunning = true // optimistic until the first poll: pausing needs positive absence
function pollPoe(): void {
  exec(POE_CMD, (err, stdout) => {
    // pgrep exits 1 on no-match, tasklist prints an INFO line; anything else
    // (missing binary, locked-down shell) fails safe as "running" — a broken
    // check must never pause someone's timer
    const running =
      err && err.code !== 1 ? true : /pathofexile/i.test(stdout)
    if (running !== poeRunning) {
      poeRunning = running
      broadcast('poe-status', running)
    }
  })
}
setInterval(pollPoe, 15_000)
pollPoe()

ipcMain.handle('pob-import', async (_e, input: string) => {
  let code = input.trim()
  const url = /pobb\.in\/([A-Za-z0-9_-]+)/.exec(code)
  if (url) {
    const res = await fetch(`https://pobb.in/${url[1]}/raw`)
    if (!res.ok) throw new Error(`pobb.in fetch failed (${res.status})`)
    code = await res.text()
  }
  return parsePob(decodePobCode(code))
})

const pobBuildsDirs = () => [
  ...(process.env.POB_BUILDS_DIR ? [process.env.POB_BUILDS_DIR] : []),
  join(app.getPath('documents'), 'Path of Building', 'Builds'),
  // Linux: PoB running under Wine/Lutris keeps builds in the prefix's Documents
  join(app.getPath('home'), '.wine/drive_c/users', process.env.USER ?? '', 'Documents/Path of Building/Builds')
]

ipcMain.handle('pob-list', () => pobBuildsDirs().flatMap((d) => listBuildFiles(d)))
ipcMain.handle('pob-read', (_e, path: string) => parsePob(readFileSync(path, 'utf8')))

// Watch a linked PoB build file; every save in PoB re-parses and pushes to all windows.
let watchTimer: NodeJS.Timeout | null = null
ipcMain.on('watch-build', (_e, path: string | null) => {
  if (watchTimer) {
    clearInterval(watchTimer)
    watchTimer = null
  }
  if (!path) return
  let lastMtime = 0
  const check = () => {
    try {
      const m = statSync(path).mtimeMs
      if (m === lastMtime) return
      lastMtime = m
      broadcast('build-updated', parsePob(readFileSync(path, 'utf8')))
    } catch {
      // file missing or mid-write; retry next tick
    }
  }
  check() // immediate: picks up edits made while the app was closed
  watchTimer = setInterval(check, 3000)
})

// renderers pull initial state on mount: the did-finish-load pushes can race
// listener registration in the page
ipcMain.handle('init-state', () => ({
  logPath: currentLogPath,
  idx: lastIdx,
  version: app.getVersion(),
  allowPrerelease: !!loadConfig().allowPrerelease,
  poeRunning
}))

ipcMain.on('set-prerelease', (_e, v: boolean) => {
  patchConfig({ allowPrerelease: v })
  autoUpdater.allowPrerelease = v
  // opting into beta should surface a waiting pre-release right away
  if (v && app.isPackaged) autoUpdater.checkForUpdates().catch(() => {})
})

ipcMain.handle('check-updates', async () => {
  if (!app.isPackaged) return null
  try {
    const r = await autoUpdater.checkForUpdates()
    return { current: app.getVersion(), latest: r?.updateInfo.version ?? null }
  } catch {
    return { current: app.getVersion(), latest: null }
  }
})

// main window is the position authority; relay its idx to other windows
ipcMain.on('sync-idx', (e, idx: number) => {
  lastIdx = idx
  for (const w of BrowserWindow.getAllWindows())
    if (w.webContents !== e.sender) w.webContents.send('idx-sync', idx)
})

let mini: BrowserWindow | null = null

function toggleMini(): void {
  if (mini) {
    mini.close()
    return
  }
  mini = new BrowserWindow({
    width: 320,
    height: 440,
    minWidth: 240,
    minHeight: 180,
    ...loadConfig().miniBounds,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#0b0d10',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })
  mini.setAlwaysOnTop(true, 'screen-saver') // above borderless-fullscreen games
  mini.once('ready-to-show', () => mini?.show())
  const saveBounds = () => mini && patchConfig({ miniBounds: mini.getBounds() })
  mini.on('moved', saveBounds)
  mini.on('resized', saveBounds)
  mini.on('closed', () => (mini = null))
  mini.webContents.on('did-finish-load', () => {
    mini?.webContents.send('log-status', currentLogPath)
    mini?.webContents.send('idx-sync', lastIdx)
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    mini.loadURL(`${process.env.ELECTRON_RENDERER_URL}?mini`)
  } else {
    mini.loadFile(join(__dirname, '../renderer/index.html'), { search: 'mini' })
  }
}

ipcMain.on('toggle-mini', toggleMini)
// locked mini = fully frozen geometry: dragging is blocked in CSS, resizing here
ipcMain.on('mini-lock', (_e, locked: boolean) => mini?.setResizable(!locked))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1080,
    height: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => mini?.close())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const logPath = () => {
    const saved = loadConfig().clientTxt
    return saved && existsSync(saved) ? saved : findClientTxt()
  }
  win.webContents.on('did-finish-load', () => {
    if (!stopTail) startTail(logPath())
    else win.webContents.send('log-status', currentLogPath)
  })

  ipcMain.handle('pick-log', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Locate Client.txt',
      filters: [{ name: 'PoE client log', extensions: ['txt'] }],
      properties: ['openFile']
    })
    const path = r.filePaths[0]
    if (r.canceled || !path) return null
    patchConfig({ clientTxt: path })
    startTail(path)
    return path
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (app.isPackaged) {
    autoUpdater.allowPrerelease = !!loadConfig().allowPrerelease
    autoUpdater.on('update-downloaded', (info) => {
      win.webContents.send('update-ready', info.version)
    })
    ipcMain.on('install-update', () => autoUpdater.quitAndInstall())
    autoUpdater.checkForUpdates().catch(() => {}) // offline/no releases yet: silently skip
    // re-check every 4h; the app stays open for whole play sessions
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600 * 1000)
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  stopTail?.()
  app.quit()
})
