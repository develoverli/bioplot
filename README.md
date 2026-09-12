# Bioplot

[![CI](https://github.com/develoverli/bioplot/actions/workflows/ci.yml/badge.svg)](https://github.com/develoverli/bioplot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea043.svg)](LICENSE)
[![Read-only extension](https://img.shields.io/badge/extension-read--only-86efac.svg)](PRIVACY.md)
[![No backend](https://img.shields.io/badge/backend-none-6b7280.svg)](PRIVACY.md)

Biopoint planner for [Chainers Farm](https://chainers.io/). It reads your plots, seeds and
animals out of your own browser, and tells you exactly what to plant to bank the most
**biopoints** in the next 24 hours.

Unofficial. Not affiliated with, endorsed by, or connected to Chainers.

---

## Why this exists

Biopoints decide your cut of every reward pool, and the maths behind them is not obvious:
growth time, plot rarity, critical drops, phytolamp bonuses and the land multiplier all
compound, and only harvests that *finish* inside the window score at all. A seed with a great
hourly rate can lose to a worse seed that fits the day more neatly.

Bioplot does that arithmetic over the whole seed catalogue — 48 families, 230 rarity variants —
and solves the schedule per plot.

## What it does

- **Draws your farm** from the real layout: every bed where it actually sits, which lamp
  covers it, and the seed to plant in it. Click a bed for its full schedule.
- **Shows where your lamps should be.** A lamp lights a shape of tiles, often several beds at
  once, so the tool tries every position on the land and reports what moving them is worth.
- **Plans around your life.** Machine (you are always there), Hybrid (every four hours) or
  Unattended (twice a day). A seed planted at a visit is spoken for until the next one, so the
  plan never assumes a replant you would not be there to do.
- **Feeds your animals.** Every feed rarity with its full recipe, what you hold of each
  ingredient, and which seed is missing — because epic feed is made from epic produce and
  nothing else.
- **Values your biopoints.** Your share of each live reward pool, what it pays, what past
  blocks paid, and which hours have historically paid most per biopoint.
- **Never invents anything.** No seed you do not own, no feed you cannot craft, no rounding in
  your favour. An unrecognised row is refused and surfaced, not guessed.

## How it works

Two parts, and nothing in between:

```
chainers.io tab ──▶ Bioplot Farm Reader (extension) ──▶ Bioplot tab
                    observes the game's own responses,   plans, entirely in the page
                    keeps the parsed rows locally
```

There is no server. No account, no backend, no analytics, no telemetry. The app is a static
page; the extension talks only to a Bioplot page open in the same browser.

### The extension

**Bioplot Farm Reader** is a Manifest V3 Chrome extension and it is **read-only**: it observes
the responses the game already made, and never issues a game request, never writes, never
signs. It never reads a token, a cookie or a password. See [PRIVACY.md](PRIVACY.md).

You do not have to take that on trust. The source is here, and an installed extension is
ordinary unminified JavaScript: `chrome://extensions` → Developer mode → **Inspect views**.

## Getting started

Requirements: Node 20+, [pnpm](https://pnpm.io/) 11 (`corepack enable` is enough), and
Python 3.10+ (the build renders the policy pages with a stdlib-only script).

```sh
git clone https://github.com/develoverli/bioplot.git
cd bioplot
pnpm install
pnpm dev          # the app on http://localhost:5173
```

Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → pick the
`extension/` folder. Then open chainers.io, let the farm load once, and press **Sync now** in
the app.

Not building it yourself? Every tagged version ships a ready-to-load zip on the
[Releases](https://github.com/develoverli/bioplot/releases) page, with a `SHA256SUMS.txt`
next to it. Unzip it and **Load unpacked** the folder the same way.

Other scripts:

```sh
pnpm test         # vitest, 90 tests across the optimizer and the extension parser
pnpm typecheck    # tsc, strict + noUncheckedIndexedAccess
pnpm build        # legal pages, typecheck, bundle → dist/
```

### Regenerating data

```sh
pnpm data:refresh   # rebuilds data/seeds.json and the extension lookup table from the game docs
pnpm icons          # rebuilds extension/icons/*.png from scripts/make-icons.py
pnpm legal          # rebuilds public/privacy.html and public/terms.html from the .md files
```

`data/seeds.json` and `data/animals.json` are generated — never hand-edit them.
`data/game.json` is hand-maintained.

## Layout

```
data/            game data (seeds/animals generated, game.json hand-maintained)
scripts/         python: doc extraction, icons, legal pages (stdlib only)
src/lib/         types, catalog, yield model, optimizer  ← the actual product
src/components/  UI
extension/       MV3 extension (inject → content-game → background → content-app → app)
public/          favicon and the generated policy pages
docs/design/     PRODUCT.md and DESIGN.md
docs/            releasing guide, publishing checklist and store-listing notes
.github/         issue and PR templates; CI, release and Pages workflows
```

The domain knowledge — the yield formula, the API probe log, and every rule the parser learned
the hard way — lives in [`.claude/skills/chainers-farm/`](.claude/skills/chainers-farm/SKILL.md).
Read it before touching `data/`, `src/lib/` or `extension/`.

## Rules that are not negotiable

1. A player's credentials never leave their machine, and are never read in the first place.
2. The extension stays read-only. It never plants, writes or signs.
3. Never guess game data. An ambiguous value is refused and surfaced.
4. Round conservatively. Growth times round up, partial harvests score zero, and a plan never
   names a seed the player does not own.
5. `pnpm test` and `pnpm build` both pass before anything is considered done.

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; the
rules above are the review checklist. Security concerns go through [SECURITY.md](SECURITY.md).

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Releases and deployment

Pushes to `main` run CI and deploy the app to GitHub Pages. A tag `vX.Y.Z` packages the
extension and publishes a GitHub Release with the zip attached. The whole procedure, including
the one-time repository setup and the Chrome Web Store submission, is in
[docs/releasing.md](docs/releasing.md); the store-listing answers are in
[docs/publishing.md](docs/publishing.md).

## Licence

[MIT](LICENSE). Third-party dependencies keep their own licences. Game data, names and artwork
belong to Chainers and are used here to describe the game to its own players.
