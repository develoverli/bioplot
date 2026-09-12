# Releasing

How a change goes from `main` to players: continuous integration, the deployed app, the
extension zip on GitHub Releases, and the Chrome Web Store. Everything here runs from the
workflows in `.github/workflows/`; the only manual steps are the ones GitHub and Google insist
on.

## What runs automatically

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | every push to `main`, every pull request | `pnpm test`, `pnpm typecheck`, `pnpm build`, and checks that `extension/manifest.json` and `package.json` agree on the version |
| `pages.yml` | every push to `main` | builds the app and deploys `dist/` to GitHub Pages |
| `release.yml` | a tag `v*` | runs the tests, zips the extension, publishes a GitHub Release with the zip and a `SHA256SUMS.txt` |
| `pools-history.yml` | hourly, and by hand | appends newly settled reward-pool blocks to `public/pools-history.json` from the public explorer and commits them (see [market-rate.md](market-rate.md)) |

## One-time repository setup

Do these once, in the repository **Settings**:

1. **Pages** → Build and deployment → Source: **GitHub Actions**. Without this the
   `pages.yml` deploy job fails with a "Pages not enabled" error.
2. **Security → Private vulnerability reporting** → Enable. `SECURITY.md` tells reporters to
   use it.
3. **Branches** → add a rule for `main` that requires the `CI` check to pass before merging.
   Optional, but it is what turns the checklist in `CONTRIBUTING.md` into a gate.
4. **Secrets and variables → Actions → Variables** (not secrets; nothing here is secret):

   | Variable | When to set it | Value |
   | --- | --- | --- |
   | `VITE_SITE_URL` | once the app has a public address you intend to keep | e.g. `https://<owner>.github.io/bioplot` or your own domain, no trailing slash |
   | `VITE_EXTENSION_URL` | once the extension is approved on the Chrome Web Store | `https://chromewebstore.google.com/detail/<extension-id>` |

   Both default to empty. While `VITE_EXTENSION_URL` is empty the app shows the "load
   unpacked" instructions instead of a store link; while `VITE_SITE_URL` is empty nothing
   depends on it. After changing a variable, re-run **Deploy to GitHub Pages** from the
   Actions tab (`workflow_dispatch`) so the deployed app picks it up.

## Cutting a release

The tag is the source of truth. `release.yml` refuses to publish if the tag does not equal the
version in **both** `extension/manifest.json` and `package.json`.

1. Bump the version in the two files, keeping them identical:

   ```sh
   # extension/manifest.json  →  "version": "0.2.0"
   # package.json             →  "version": "0.2.0"
   ```

2. If what the extension reads, or where the data goes, changed at all: update `PRIVACY.md`,
   move its "Last updated" date, and run `pnpm legal` so `public/privacy.html` matches.
3. Make sure `pnpm test` and `pnpm build` pass locally, commit, and get it onto `main`.
4. Tag and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

5. Watch the **Release** workflow. When it finishes, the release page carries
   `bioplot-farm-reader-v0.2.0.zip`, `SHA256SUMS.txt`, and auto-generated notes built from
   the pull requests since the previous tag. Edit the notes if the generated ones are not good
   enough; they are what players read.

The zip contains exactly what Chrome loads: `manifest.json`, `popup.html`, `popup.js`,
`src/`, `icons/`. The parser tests stay out.

## Deploying the app

Nothing to do: every push to `main` deploys to `https://<owner>.github.io/bioplot/`. The
Vite config uses a relative `base`, so the same build works under a repository sub-path and
at the root of a custom domain.

To use your own domain, add it under **Settings → Pages → Custom domain** (GitHub creates the
`CNAME`), then set `VITE_SITE_URL` to it.

### Letting the extension talk to the deployed app

The extension only injects its bridge into origins listed in the **third** `content_scripts`
entry of `extension/manifest.json`. Out of the box that is `localhost` and `127.0.0.1`, so a
deployed app cannot receive a farm until you add its origin:

```json
"matches": [
  "http://localhost/*",
  "http://127.0.0.1/*",
  "https://<owner>.github.io/*"
]
```

Also set `SITE_URL` at the top of `extension/popup.js` so the popup can link to the privacy
and terms pages. Both edits change what the extension ships, so they go out with a version
bump and a new release, and if the extension is on the store, a new store submission.

## Publishing to the Chrome Web Store

Google reviews every version by hand, so expect days, not minutes, the first time.

1. Register a developer account at <https://chrome.google.com/webstore/devconsole> (one-time
   fee), and complete the account's contact email and the two-factor requirement.
2. **New item** → upload the `bioplot-farm-reader-v<version>.zip` from the GitHub Release.
   Upload the release asset rather than a local zip, so what is on the store is byte-for-byte
   what the tag built.
3. Fill in the listing. The store asks for a justification for every permission and a
   declaration about data use; the honest answers are in [`publishing.md`](publishing.md).
   The description in `extension/manifest.json` is a good first paragraph.
4. **Privacy policy URL**: `https://<your app origin>/privacy.html`. The page is part of the
   deployed app, so the app has to be deployed first.
5. Submit for review. When it is approved, copy the listing URL
   (`https://chromewebstore.google.com/detail/<id>`), set it as the `VITE_EXTENSION_URL`
   repository variable, and re-run the Pages deploy. The app now links to the store instead
   of explaining "load unpacked".

For every later release: bump, tag, wait for the GitHub Release, then upload the new zip as a
new version of the same store item. The store rejects a zip whose `manifest.json` version is
not higher than the current one, which is another reason the tag and the manifest have to
agree.

## Checklist before you announce

- [ ] `CI` is green on `main`.
- [ ] The GitHub Release has the zip and the checksum file attached.
- [ ] Loaded the released zip unpacked and synced a real farm against the deployed app.
- [ ] `PRIVACY.md` and the deployed `privacy.html` say the same thing.
