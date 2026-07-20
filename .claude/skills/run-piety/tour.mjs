// Scripted screenshot tour of the piety Electron app.
// Isolated XDG_CONFIG_HOME + fake Client.txt — touches no real user state.
// Usage: npm run build && node .claude/skills/run-piety/tour.mjs
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '../../..')
const SHOTS = process.env.SCREENSHOT_DIR || '/tmp/piety-shots'
const XDG = '/tmp/piety-xdg'
const CLIENT = path.join(XDG, 'Client.txt')
fs.mkdirSync(SHOTS, { recursive: true })
fs.rmSync(XDG, { recursive: true, force: true })
fs.mkdirSync(XDG, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const P = '2026/07/20 12:00:00 1234 cff945b9 [INFO Client 1234]'
fs.writeFileSync(CLIENT, `${P} boot\n`)
const logLine = (s) => fs.appendFileSync(CLIENT, `${P} ${s}\n`)

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', APP_DIR],
  env: { ...process.env, XDG_CONFIG_HOME: XDG, POE_CLIENT_TXT: CLIENT },
  timeout: 30_000
})
const page = await app.firstWindow()
await page.waitForSelector('#root > *', { timeout: 15_000 })
await sleep(1500)

async function ss(name, p = page) {
  await p.screenshot({ path: path.join(SHOTS, name + '.png') })
  console.log('shot', name)
}
async function clickText(text, p = page) {
  const r = await p.evaluate((t) => {
    const els = [...document.querySelectorAll('button')]
    const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
    if (!el) return 'NOT_FOUND'
    el.click()
    return 'OK'
  }, text)
  console.log('click', text, '→', r)
  await sleep(300)
}
async function setSize(w, h, i = 0) {
  await app.evaluate(({ BrowserWindow }, { w, h, i }) => {
    BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[i]?.setContentSize(w, h)
  }, { w, h, i })
  await sleep(500)
}

try {
  // ---- wizard ----
  await ss('01-wizard-log')
  await clickText('NEXT')
  await ss('02-wizard-import-empty')
  const code = fs.readFileSync(path.join(APP_DIR, 'test/fixtures/pob-code.txt'), 'utf8').trim()
  await page.evaluate((c) => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, c)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, code)
  await clickText('PARSE')
  await sleep(1200)
  await ss('03-wizard-import-parsed')
  await clickText('NEXT')
  await ss('04-wizard-trees')
  await clickText('NEXT')
  await ss('05-wizard-route')
  await clickText('NEXT')
  await ss('06-wizard-done')
  await clickText('FINISH')
  await sleep(800)

  // ---- default view, idle state ----
  await ss('07-split-idle')

  // ---- simulate live play: run start, char name, a few zones ----
  logLine('Generating level 1 area "1_1_1" with seed 42')
  logLine(': You have entered The Twilight Strand.')
  await sleep(900)
  logLine(': Piety (Witch) is now level 2')
  await sleep(900)
  logLine('Generating level 1 area "1_1_town" with seed 43')
  logLine(": You have entered Lioneye's Watch.")
  await sleep(900)
  logLine('Generating level 2 area "1_1_2" with seed 44')
  logLine(': You have entered The Coast.')
  await sleep(900)
  logLine(': Piety (Witch) is now level 4')
  await sleep(1200)
  await ss('08-split-live')

  // ---- other views ----
  await clickText('FOCUS')
  await ss('09-focus')
  await clickText('MIXED')
  await ss('10-mixed')
  await clickText('DENSE')
  await ss('11-dense-gems')
  await clickText('SOCKETS')
  await ss('12-dense-sockets')
  await clickText('TREE')
  await sleep(600)
  await ss('13-dense-tree')
  await clickText('LOG')
  await ss('14-dense-log')
  await clickText('PACE')
  await ss('15-dense-pace')

  // ---- pace full panel via footer chip ----
  await page.evaluate(() => document.querySelector('.pace-chip')?.click())
  await sleep(400)
  await ss('16-pace-panel')
  await clickText('CLOSE')

  // ---- settings ----
  await page.evaluate(() => document.querySelector('.cog-btn')?.click())
  await sleep(300)
  await ss('17-settings')
  await clickText('CLOSE')

  // ---- band view (short window) ----
  await clickText('SPLIT')
  await setSize(1600, 420)
  await ss('18-band-short')
  await setSize(1080, 640)

  // ---- narrow window ----
  await setSize(760, 640)
  await ss('19-narrow-split')
  await clickText('MIXED')
  await ss('20-narrow-mixed')
  await setSize(1080, 640)
  await clickText('SPLIT')

  // ---- mini overlay ----
  await clickText('MINI')
  await sleep(1500)
  const wins = app.windows()
  const mini = wins.find((w) => w !== page)
  if (mini) {
    await mini.waitForSelector('.mini', { timeout: 10_000 })
    await ss('21-mini-default', mini)
    await setSize(600, 260, 1)
    await ss('22-mini-wide', mini)
    await setSize(240, 400, 1)
    await ss('23-mini-min', mini)
  } else {
    console.log('NO MINI WINDOW; windows:', wins.map((w) => w.url()))
  }

  // ---- guide-only (no build) state: clear build, reload ----
  await page.evaluate(() => {
    localStorage.removeItem('pob-build')
    localStorage.setItem('setup-done', 'true')
  })
  await page.reload()
  await page.waitForSelector('#root > *', { timeout: 15_000 })
  await sleep(800)
  await clickText('SPLIT')
  await ss('24-split-no-build')
} catch (e) {
  console.log('TOUR ERROR:', e.message)
  await ss('99-error').catch(() => {})
}

await app.close()
console.log('done —', SHOTS)
