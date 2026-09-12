# Security policy

Bioplot ships a browser extension that reads a player's farm inventory. That makes its
privacy claims worth attacking, and worth reporting on.

## What counts

Anything that would make one of these statements false:

- The extension never reads or forwards a session token, cookie, authorisation header or
  password.
- The extension never issues a game request, never writes to an account, never signs.
- Parsed rows reach only a Bioplot page open in the same browser, and no server.
- The web app makes no request to any server the project controls, because there is none.

Also in scope: a way for a malicious page to impersonate the app and receive a player's
inventory from the extension, or for a malicious page to impersonate the extension.

## Reporting

Use GitHub's private vulnerability reporting on this repository
(**Security** → **Report a vulnerability**), so the details stay out of the public tracker
until a fix ships. If that is unavailable to you, open an issue that says only "security,
please contact me" and a maintainer will reach out.

Please include the browser and version, the extension version from `extension/manifest.json`,
and steps to reproduce.

## Supported versions

Only the latest commit on `main` and the latest published extension version receive fixes.

## Verifying the claims yourself

An installed extension is ordinary unminified JavaScript: `chrome://extensions` → Developer
mode → **Inspect views**. The network tab of your browser shows the rest from the outside.
If what the code does and what [PRIVACY.md](PRIVACY.md) says ever disagree, the code is the
truth and the page is a bug.
