# Bioplot — project rules

Biopoint planner for Chainers Farm. Static React app plus a read-only browser extension.
Open source (MIT), no backend, no account, no telemetry.

## Read this first

`.claude/skills/chainers-farm/SKILL.md` holds the game mechanics, the yield formula, and the
blockchain/API probe log. Load it before touching anything under `data/`, `src/lib/`, or
`extension/`.

## Hard rules

1. **Never send a player's credentials anywhere.** No proxy, no server-side token storage, no
   "just for testing" endpoint that takes a session token. The extension reads locally and
   passes parsed rows only.
2. **The extension stays read-only.** It observes responses the game already made. It never
   issues a game request, never writes, never signs. Do not add a "plant for me" feature.
3. **Never guess game data.** If a value is ambiguous (a numeric rarity, an unlabelled field),
   refuse the row and surface it. A silently wrong number is worse than a missing plan.
4. **Round conservatively.** Growth times round up, partial harvests score zero. Plans must
   never promise more than the game will deliver. A plan must never name a seed the player
   does not own: renewable means *comes back*, not *appears from nowhere*.
5. **Only the service worker writes storage.** The farm runs in an iframe, so content scripts
   run once per frame; when each frame owned its own list they overwrote each other and farm
   captures disappeared at random. `src/background.js` is the single writer, and content
   scripts stay stateless forwarders.

## Stack

- pnpm, Vite, React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind v4.
- zustand for state, zod for every external payload, `@tanstack/react-table` for the ranking,
  lucide-react for icons, `@fontsource-variable/*` for self-hosted fonts.
- vitest for tests. The optimizer and the extension parser both have real coverage — keep it.

## Layout

```
data/            game data (seeds/animals generated, game.json hand-maintained)
scripts/         python extractors that regenerate data/ and the extension lookup table
src/lib/         types, catalog, yield model, optimizer  ← the actual product
                 chain.ts / chainSync.ts / chainDb.ts: pool history from the public explorer
src/components/  UI
extension/       MV3 extension (inject → content-game → background → content-app → app)
docs/design/     PRODUCT.md and DESIGN.md
```

## Working agreements

- Design decisions live in `docs/design/DESIGN.md`. Follow the tokens; never hardcode a colour.
- No native `alert` / `confirm` / `prompt`. Use the `<Modal>` in `src/components/ui.tsx`.
- Rarity is always colour **plus** the word.
- Regenerate data with `pnpm data:refresh`; never hand-edit `data/seeds.json`.
- Anything that plans takes its catalogue as an argument. `data/seeds.json` is the fallback,
  not the source of truth: the game's `rewardPoolBaseWeight` wins when it has been captured.
- The only outside host the app talks to besides the game's CDN is `explorer.chainers.io`,
  read-only, with public addresses and block numbers. See `docs/market-rate.md` before
  touching `src/lib/chain*.ts`; a crop the chain names that the catalogue cannot weigh is
  reported, never guessed.
- `pnpm test` and `pnpm build` both pass before anything is considered done.
