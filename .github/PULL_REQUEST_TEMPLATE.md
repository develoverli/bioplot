## What

<!-- One change. What it does and why. -->

## How it was tested

- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] Loaded `extension/` unpacked and synced a real farm (if the extension changed)

## Checklist

- [ ] No credentials, tokens or cookies are read or forwarded (see CONTRIBUTING.md rule 1)
- [ ] The extension still issues no game request of its own (rule 2)
- [ ] Ambiguous game data is refused, not guessed (rule 3)
- [ ] Rounding stays conservative (rule 4)
- [ ] New logic in `src/lib/` or `extension/src/parse.js` comes with a test
- [ ] `PRIVACY.md` updated and `pnpm legal` run, if what is read or where it goes changed
