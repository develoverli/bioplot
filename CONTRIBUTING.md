# Contributing to Bioplot

Thanks for looking. This is a small, opinionated tool, and the rules below exist because each
one was learned the hard way. Taking part means following the
[code of conduct](CODE_OF_CONDUCT.md).

## Before you start

Read [`.claude/skills/chainers-farm/SKILL.md`](.claude/skills/chainers-farm/SKILL.md). It
holds the yield formula, the game mechanics and the API probe log. Almost every non-trivial
change touches something it explains.

## Setup

```sh
pnpm install
pnpm dev          # app on http://localhost:5173
pnpm test         # vitest
pnpm typecheck    # tsc -b --noEmit
pnpm build        # legal pages + typecheck + bundle
```

Node 20+, pnpm 11, Python 3.10+ (stdlib only, for the scripts).

Load `extension/` unpacked at `chrome://extensions` to test the reader against the live game.

## The rules

These are not style preferences. A pull request that breaks one will not be merged, however
good the rest of it is.

1. **Never send a player's credentials anywhere.** No proxy, no server-side token storage, no
   "just for testing" endpoint that takes a session token. The extension reads locally and
   passes parsed rows only.
2. **The extension stays read-only.** It observes responses the game already made. It never
   issues a game request, never writes, never signs. Do not add a "plant for me" feature.
3. **Never guess game data.** If a value is ambiguous (a numeric rarity, an unlabelled field),
   refuse the row and surface it. A silently wrong number is worse than a missing plan.
4. **Round conservatively.** Growth times round up, partial harvests score zero. Plans must
   never promise more than the game will deliver, and never name a seed the player does not
   own.
5. **Only the service worker writes storage.** Content scripts are stateless forwarders; see
   `extension/src/background.js` for why.
6. **`pnpm test` and `pnpm build` both pass** before anything is considered done.

## Working agreements

- TypeScript is strict with `noUncheckedIndexedAccess`. No `any`.
- Every external payload goes through a zod schema before it is trusted.
- Anything that plans takes its catalogue as an argument. `data/seeds.json` is the fallback,
  not the source of truth; the game's own `rewardPoolBaseWeight` wins when captured.
- Design tokens live in `docs/design/DESIGN.md`. Never hardcode a colour. Rarity is always
  colour **plus** the word.
- No native `alert` / `confirm` / `prompt`. Use `<Modal>` from `src/components/ui.tsx`.
- Regenerate data with `pnpm data:refresh`; never hand-edit `data/seeds.json` or
  `data/animals.json`.
- The optimizer and the extension parser both have real test coverage. Keep it: a change to
  either comes with a test that would have failed before it.

## Pull requests

- One change per pull request. Fixes are fixes; no drive-by refactors.
- Commit messages in English, Conventional Commits style (`feat:`, `fix:`, `docs:`, ...).
- Say what you tested against. "Loaded the extension on a farm with N plots and synced" is
  the sentence reviewers are looking for.
- If a change alters what the extension reads or where data goes, update `PRIVACY.md`, bump
  its "last updated" date, and run `pnpm legal`.

Every pull request runs `ci.yml`: tests, typecheck, build, and a check that
`extension/manifest.json` and `package.json` carry the same version. Releases are cut from
tags; see [docs/releasing.md](docs/releasing.md).

## Reporting bugs

Open an issue with the template. For anything that looks like a security problem, follow
[SECURITY.md](SECURITY.md) instead.
