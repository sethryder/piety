---
name: run-piety
description: Build, launch, and drive the piety Electron app headlessly. Use when asked to run the app, take screenshots of its UI, or verify a change visually.
---

Piety is an Electron app (electron-vite). Drive it with Playwright against the
built output in `out/`. Both scripts isolate all state (XDG_CONFIG_HOME +
POE_CLIENT_TXT point at /tmp) so real user config and localStorage are never
touched, and they simulate a live Client.txt so the app shows in-game state.

## Prerequisites

```bash
npm i --no-save playwright-core   # not a project dep; one-time per checkout
```

On WSL, WSLg provides DISPLAY — no xvfb needed. On truly headless Linux,
prefix launches with `xvfb-run -a`.

## Screenshot tour (main agent path)

```bash
npm run build
node .claude/skills/run-piety/tour.mjs
```

One shot, no interaction needed. Walks the wizard (imports the PoB fixture
from `test/fixtures/pob-code.txt`), simulates play via fake Client.txt lines
(run start, level-ups, zone entries), and screenshots every view: wizard
steps, SPLIT/FOCUS/MIXED/DENSE (all tabs), pace panel, settings, band view,
narrow window, mini overlay at three sizes, and the no-build state.
Screenshots land in `/tmp/piety-shots/` (override: `SCREENSHOT_DIR`).
**Open and look at the screenshots** — that's the point.

## REPL driver (custom flows)

```bash
node .claude/skills/run-piety/driver.mjs
```

Needs interactive stdin; without a TTY, feed it through a FIFO:
`mkfifo /tmp/piety-in && node driver.mjs < /tmp/piety-in &` then
`echo launch > /tmp/piety-in`.

| command | what it does |
|---|---|
| `launch` | launch the app (isolated env, fake Client.txt) |
| `ss [name]` | screenshot → `/tmp/piety-shots/<name>.png` |
| `click <css-sel>` / `click-text <text>` | DOM click |
| `pob` | paste the fixture PoB code into the wizard textarea |
| `zone <areaId> <areaLevel>` | append a "Generating area" line to the fake log (advances route) |
| `level <name> <n>` | append a level-up line (sets character chip) |
| `size <WxH> [winIdx]` | resize a window |
| `use mini` / `use main` | switch target window |
| `lsset <key> <json>` / `reload` / `eval <js>` / `text [sel]` | state poking |
| `quit` | close app, exit |

## Gotchas

- The app tails Client.txt by polling every 500ms — sleep ~1s after
  appending log lines before screenshotting.
- Route area IDs match `src/renderer/src/routes/act-*.txt` (`1_1_2` etc.);
  the run starts on a `Generating … "1_1_1"` line (Twilight Strand).
- The mini overlay is a second window (`?mini`); find it via `use mini`.
- `--no-sandbox` is required; Electron's sandbox doesn't work in containers.
