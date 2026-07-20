# Piety: a Path of Exile campaign leveling guide

Piety is a desktop companion for leveling through the Path of Exile campaign. It reads your `Client.txt` log to follow you zone by zone, shows the next steps from a proven leveling route, tells you which gems to buy and when, tracks your passive tree progression against your Path of Building specs, and times your act splits against your personal best.

It is built for a second monitor. Not an in-game overlay, just a normal window you can snap wherever you want, plus an optional small always-on-top window for single monitor setups.

<!-- screenshot: drop a main-window capture here, e.g. ![Piety](docs/screenshot.png) -->

## Features

- **Zone-by-zone route guide** based on the [exile-leveling](https://github.com/HeartofPhos/exile-leveling) routes for acts 1 to 10, with kill/quest/waypoint/portal steps and layout hints
- **Automatic position tracking** by tailing `Client.txt`. Read only, no game files touched, no injection
- **Gem shopping list** built from your Path of Building import: what to buy, from which vendor, after which quest, for your class. Gems you get for free (starting gem, beach chest) are marked as granted
- **Passive tree progression** rendered on the real skill tree: what you should have allocated by now and where the next points go, based on the tree specs in your PoB build
- **Live Path of Building sync**: link a build from your local PoB saves and every save in PoB updates the app. Pasting an export code or a pobb.in link works too
- **Pace timer** with per-act splits, personal best comparison, and a projected campaign finish. Starts automatically when you enter the Twilight Strand, stops at Karui Shores
- **Four layouts** (glance, mixed, dense checklist, split with tree and gems) plus a compact band layout when the window is short, and a mirror option for left-side monitors
- **Mini overlay**: a small always-on-top window with the current zone, steps, and gem alerts. Lockable so you cannot drag it by accident
- **Auto updates** via GitHub releases

## Getting started

1. Download the latest `Piety-Setup-*.exe` from [Releases](https://github.com/sethryder/piety/releases) and run it. Windows SmartScreen may warn about an unknown publisher; the build is unsigned for now
2. The setup wizard walks you through it: locate `Client.txt` (usually found automatically, including Steam libraries on other drives), import your build from local PoB saves or a pasted code, map your tree specs to act breakpoints, and pick league start or twink gear routing
3. Play. The guide follows you as you enter zones

If you use the mini overlay on top of the game, run PoE in Windowed Fullscreen. Exclusive fullscreen draws over everything.

## Development

```bash
npm install
npm run dev          # run locally (Electron + Vite + React)
npm test             # parser and logic tests
npm run package:win  # build the Windows installer into dist/
npm run update-data  # refresh vendored routes, gem/quest data, and the passive tree
```

Game data is vendored, so the app works fully offline. `npm run update-data` refetches everything from upstream at league start, including the latest passive tree from GGG's official export. Run the tests afterwards; they parse the real data files and catch upstream format changes.

## Data sources and thanks

- Route and gem/quest data from [HeartofPhos/exile-leveling](https://github.com/HeartofPhos/exile-leveling) (MIT)
- Zone layout images from [Lailloken/Exile-UI](https://github.com/Lailloken/Exile-UI) (MIT)
- Passive tree data from [grindinggear/skilltree-export](https://github.com/grindinggear/skilltree-export)
- Build parsing for [Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding) exports

## Disclaimer

Piety is a fan-made tool. It is not affiliated with or endorsed by Grinding Gear Games. It only reads the `Client.txt` log file, which is explicitly allowed for third party tools.
