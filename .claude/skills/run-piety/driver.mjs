// REPL driver for the piety Electron app. See SKILL.md for commands.
// Isolated XDG_CONFIG_HOME + fake Client.txt — touches no real user state.
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '../../..')
const SHOTS = process.env.SCREENSHOT_DIR || '/tmp/piety-shots'
const XDG = '/tmp/piety-xdg'
const CLIENT = path.join(XDG, 'Client.txt')
fs.mkdirSync(SHOTS, { recursive: true })

const P = '2026/07/20 12:00:00 1234 cff945b9 [INFO Client 1234]'
const logLine = (s) => fs.appendFileSync(CLIENT, `${P} ${s}\n`)
let seed = 100

let app = null
let page = null

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched')
    fs.rmSync(XDG, { recursive: true, force: true })
    fs.mkdirSync(XDG, { recursive: true })
    fs.writeFileSync(CLIENT, `${P} boot\n`)
    app = await electron.launch({
      executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
      args: ['--no-sandbox', APP_DIR],
      env: { ...process.env, XDG_CONFIG_HOME: XDG, POE_CLIENT_TXT: CLIENT },
      timeout: 30_000
    })
    page = await app.firstWindow()
    await page.waitForSelector('#root > *', { timeout: 15_000 }).catch(() => {})
    console.log('launched.', app.windows().length, 'windows')
  },

  // zone <areaId> [areaLevel] — appends a gen line; the app advances after its ~500ms poll
  async zone(arg) {
    const [id, lvl] = arg.split(/\s+/)
    logLine(`Generating level ${lvl ?? 1} area "${id}" with seed ${seed++}`)
    console.log('gen', id)
  },

  // level <name> <n> — appends a level-up line
  async level(arg) {
    const [name, n] = arg.split(/\s+/)
    logLine(`: ${name} (Witch) is now level ${n ?? 2}`)
    console.log('level', name, n)
  },

  async size(arg) {
    const [wh, idx] = arg.split(/\s+/)
    const [w, h] = wh.split('x').map(Number)
    await app.evaluate(({ BrowserWindow }, { w, h, i }) => {
      BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i]?.setContentSize(w, h)
    }, { w, h, i: Number(idx ?? 0) })
    console.log('resized', w, h)
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first')
    const f = path.join(SHOTS, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  async click(sel) {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, sel)
    console.log('click', sel, '→', r)
  },

  async 'click-text'(text) {
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')]
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK: ' + el.tagName
    }, text)
    console.log('click-text', JSON.stringify(text), '→', r)
  },

  // paste the fixture PoB code into the wizard textarea
  async pob() {
    const code = fs.readFileSync(path.join(APP_DIR, 'test/fixtures/pob-code.txt'), 'utf8').trim()
    const r = await page.evaluate((c) => {
      const ta = document.querySelector('textarea')
      if (!ta) return 'NO_TEXTAREA'
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, c)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 'OK ' + c.length
    }, code)
    console.log('pob →', r)
  },

  async lsset(arg) {
    const i = arg.indexOf(' ')
    await page.evaluate(({ key, val }) => localStorage.setItem(key, val), {
      key: arg.slice(0, i),
      val: arg.slice(i + 1)
    })
    console.log('set', arg.slice(0, i))
  },

  async reload() {
    await page.reload()
    await page.waitForSelector('#root > *', { timeout: 15_000 }).catch(() => {})
    console.log('reloaded')
  },

  async eval(expr) {
    try {
      console.log(JSON.stringify(await page.evaluate(expr)))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  },

  async text(sel) {
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null)
    )
  },

  async use(which) {
    const wins = app.windows()
    page = which === 'mini' ? wins.find((w) => w.url().includes('mini')) ?? wins.at(-1) : wins[0]
    console.log('using', page.url())
  },

  async windows() {
    for (const w of app.windows()) console.log(' ', w.url())
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null
    page = null
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  }
}

// raw fd read: Electron steals process.stdin
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })

rl.on('line', async (line) => {
  const t = line.trim()
  const i = t.indexOf(' ')
  const cmd = i === -1 ? t : t.slice(0, i)
  const rest = i === -1 ? '' : t.slice(i + 1)
  if (!cmd) return rl.prompt()
  const fn = COMMANDS[cmd]
  if (!fn) {
    console.log('unknown:', cmd, '— try: help')
    return rl.prompt()
  }
  try {
    await fn(rest)
  } catch (e) {
    console.log('ERROR:', e.message)
  }
  if (cmd === 'quit') {
    rl.close()
    process.exit(0)
  }
  rl.prompt()
})
rl.on('close', async () => {
  await COMMANDS.quit()
  process.exit(0)
})

console.log('piety driver — "help" for commands, "launch" to start')
rl.prompt()
