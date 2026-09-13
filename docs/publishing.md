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
3. **Point the app at the right listing.** Upstream needs nothing: the app links to the
   official [Bioplot Farm Reader](https://chromewebstore.google.com/detail/bioplot-farm-reader/acjgafpghcopmjnplglomadieaodjcha)
   listing by default. A fork that publishes its own extension sets the `VITE_EXTENSION_URL`
   repository variable (or `.env.local`) to its own store URL once approved, and redeploys.
4. Check the copyright year and the "last updated" dates in `PRIVACY.md` and `TERMS.md`, then
   run `pnpm legal` so `public/privacy.html` and `public/terms.html` match.
5. If you fork and publish under your own name, point the contact links in `src/lib/links.ts`,
   `PRIVACY.md` and `TERMS.md` at your own issue tracker.

## The store listing

These are the answers the live listing was submitted with. Keep them current: when a release
changes a permission, a host or what happens to the data, update this page and the listing's
**Privacy practices** tab together.

Chrome Web Store asks for a justification for every permission. The honest answers:

| Item | Why |
| --- | --- |
| `storage` | Holds the captured farm in the browser profile so the popup can show counts and the app can ask for it later. Never leaves the device. |
| `https://*.chainers.io/*` | The only site read. The content scripts observe the farm responses the game already made. |
| Remote code | None. Everything runs from the packaged files. |
| Data collected | None leaves the device. No account, no backend, no analytics, no telemetry. |

### The listing text

The manifest `description` is capped at 132 characters and is what shows under the name. The
**detailed description** has room for the rest, and the store's **Homepage** and **Support**
URL fields take the repository and its issue tracker. Saying it is open source and linking the
source is allowed and is the point: the privacy claims are only worth as much as the code
behind them.

Ready to paste as the detailed description:

> Bioplot plans your Chainers Farm. It reads your plots, seeds and animals out of your own
> browser and works out what to plant to bank the most biopoints in the next 24 hours, where
> your phytolamps are worth most, what feed each animal can actually be given, and which reward
> pool to send a harvest to.
>
> This reader is the half that reads. It is strictly read-only: it observes the responses the
> game already made, and never plants, harvests, buys, signs or writes anything to your
> account. It never reads a session token, a cookie or a password. Nothing is sent to any
> server, because there is no server: the parsed rows go only to a Bioplot page open in the
> same browser.
>
> Open source under the MIT licence. Every line of the extension and the planner is public, and
> an installed extension is ordinary unminified JavaScript you can read at chrome://extensions
> with Developer mode on:
>
> https://github.com/develoverli/bioplot
>
> Unofficial. Not affiliated with, endorsed by, or connected to Chainers.

- **Homepage URL**: `https://github.com/develoverli/bioplot`
- **Support URL**: `https://github.com/develoverli/bioplot/issues`

### The answers, ready to paste

**Single purpose**

> Bioplot Farm Reader has one purpose: to read the player's own Chainers Farm inventory from the game in their browser and hand it to the Bioplot planner page, so the planner can work out what to plant. It is read-only and does nothing else.

**Host permission justification**

> The extension reads the player's own farm from the game and hands it to the Bioplot planner page. Nothing else, and no other host.
>
> https://chainers.io/* and https://*.chainers.io/* - the only site read. Content scripts observe the responses the game itself already requested (the farm runs in an iframe, hence all_frames) and parse the player's plots, seeds, animals and inventory. The extension never issues a game request, never writes to the account, and never reads a token, cookie, authorisation header or password.
>
> http://localhost/*, http://127.0.0.1/* and https://develoverli.github.io/* - the Bioplot page itself, run locally or served from its own GitHub Pages origin. A content script there is the bridge that lets that page ask the extension for the rows it already parsed. The parsed rows never leave the browser: there is no server and no other destination.

**`storage` justification**

> storage holds the parsed farm in the browser profile so the popup can show what was captured and the Bioplot page can ask for it later. It stays on the device and is wiped by Reset in the popup.

**Remote code**: answer **No**. Every script is packaged; there is no `eval`, no `new Function`,
no dynamic `import()`, no external `<script src>` and no wasm. If the console still asks for a
justification, paste:

> No remote code. Every script is packaged with the extension: popup.js, src/parse.js, src/seed-names.js, src/inject.js, src/content-game.js, src/content-app.js and src/background.js. No eval, no new Function, no dynamic import, no external script tag, no wasm.

**Data collected**: none. Tick nothing, and certify that no user data is sold, transferred for
purposes unrelated to the item's single purpose, or used to determine creditworthiness.

**Trader status** (EEA declaration, account level): a free, non-commercial, MIT-licensed
extension with no ads and no payments is a non-trader publication. Declaring trader status makes
the publisher's name, address and phone number public on the listing. It is a legal declaration
the publisher must make themselves; read Google's own explanation before confirming.

Privacy policy URL for the listing: `https://<domain>/privacy.html`. For the upstream
deployment that is `https://develoverli.github.io/bioplot/privacy.html`; the manifest and
`extension/popup.js` already point at that origin.
