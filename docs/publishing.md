# Publishing checklist

For anyone deploying their own copy of Bioplot or submitting the extension to a store. Each
item below is a link that 404s or a claim that is false until it is done. The mechanics
(workflows, tags, repository variables, the store console) are in [releasing.md](releasing.md);
this page is the list of things that have to be true.

## Before deploying

1. **Pick the domain**, deploy the app, and set it in two places:
   - the `VITE_SITE_URL` repository variable (or `.env.local` for a local build)
   - `extension/popup.js` → `const SITE_URL = 'https://<domain>'`
2. **Add the app's origin** to `extension/manifest.json` → the third `content_scripts` entry's
   `matches`, or the extension cannot talk to the deployed page.
3. **Submit the extension**, then set the `VITE_EXTENSION_URL` repository variable (or
   `.env.local`) to the store URL and redeploy, so the app stops showing the "load unpacked"
   instructions.
4. Check the copyright year and the "last updated" dates in `PRIVACY.md` and `TERMS.md`, then
   run `pnpm legal` so `public/privacy.html` and `public/terms.html` match.
5. If you fork and publish under your own name, point the contact links in `src/lib/links.ts`,
   `PRIVACY.md` and `TERMS.md` at your own issue tracker.

## The store listing

Chrome Web Store asks for a justification for every permission. The honest answers:

| Item | Why |
| --- | --- |
| `storage` | Holds the captured farm in the browser profile so the popup can show counts and the app can ask for it later. Never leaves the device. |
| `https://*.chainers.io/*` | The only site read. The content scripts observe the farm responses the game already made. |
| Remote code | None. Everything runs from the packaged files. |
| Data collected | None leaves the device. No account, no backend, no analytics, no telemetry. |

Privacy policy URL for the listing: `https://<domain>/privacy.html`.
