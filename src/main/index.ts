import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findClientTxt, tailLog } from './logtail'
import { decodePobCode } from './pob'
import { listBuildFiles } from './pobBuilds'
import { parsePob } from '../shared/pob'

const configPath = () => join(app.getPath('userData'), 'config.json')

function loadConfig(): { clientTxt?: string; miniBounds?: Electron.Rectangle } {
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

const pobBuildsDir = () =>
  process.env.POB_BUILDS_DIR ?? join(app.getPath('documents'), 'Path of Building', 'Builds')

ipcMain.handle('pob-list', () => listBuildFiles(pobBuildsDir()))
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
