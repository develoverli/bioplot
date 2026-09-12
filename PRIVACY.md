# Privacy policy — Bioplot

Last updated: 2026-09-12

**Short version: nothing you do here reaches us, because there is no "us" to reach.**
The web app is a static page and the extension talks to no server of ours. There is no
account, no backend, no analytics, and no telemetry.

## What the extension reads

While you have chainers.io open, the extension observes the responses the game itself
requests, and keeps the ones that describe your farm: your plots, your seeds, your animals,
your inventory and the game's public catalogues.

It does this passively. It never issues a request of its own, never plants, harvests, buys,
merges or signs anything, and never writes to your account.

## What it never touches

- Session tokens, cookies, authorisation headers or passwords. These are not read, not stored
  and not forwarded. Only parsed inventory rows leave the extension, and only to a
  bioplot page open in the same browser.
- Any site other than `chainers.io` and the Bioplot page itself.
- Your wallet. Nothing is signed, and no transaction is ever created.

## Where the data lives

In your browser profile, in the extension's local storage, and in the web page's
`localStorage`. It stays on your device. Both are wiped by **Reset** in the extension popup or
**Reset everything** in the app.

Uninstalling the extension removes its copy. Clearing site data for the app removes the other.

## Third parties

Two, both public and both read-only:

- Seed artwork is loaded directly from the game's own CDN (`static.chainers.io`) using the
  URLs the game publishes, so that CDN sees an ordinary image request from your browser.
- Reward-pool history is read from the chain's public block explorer
  (`explorer.chainers.io`). Those requests name pool vault addresses and block numbers, which
  are public for everyone; they never include your wallet, your account, or anything from the
  capture. How this works is written up in `docs/market-rate.md`.

No other external request is made.

## Changes

This page carries the date it was last changed, at the top. A change that affects what is read
or where it goes will move that date; check it if you want to know whether anything has.

## Verifying this yourself

You do not have to take this on trust. A browser extension is installed as ordinary,
unminified JavaScript: open `chrome://extensions`, turn on Developer mode, and use **Inspect
views** or **service worker** to read every line of it. The network tab of your own browser
will show you the same thing from the outside: while Bioplot is open, it makes no request to
any server we control, because there is none. The only hosts you will see are the game's CDN
and the chain's public explorer.

## Contact

[Open an issue](https://github.com/develoverli/bioplot/issues) on GitHub. The source of both the app and
the extension is published there under the MIT licence.
