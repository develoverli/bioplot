/**
 * Runs on the bioplot web app.
 *
 * Answers two page messages and nothing else: a PING (so the app can show that the
 * extension is installed) and a REQUEST_INVENTORY (so the app can plan). Only parsed
 * inventory rows cross this boundary — never a raw capture, a header, or a token.
 */
;(() => {
  const APP_SOURCE = 'bioplot'
  const EXTENSION_SOURCE = 'bioplot-extension'

  /** See content-game.js: a reloaded extension orphans the scripts in open tabs. */
  const alive = () => {
    try {
      return Boolean(globalThis.chrome.runtime?.id)
    } catch {
      return false
    }
  }

  if (!alive()) return
  const VERSION = globalThis.chrome.runtime.getManifest().version

  const reply = (message) => window.postMessage({ source: EXTENSION_SOURCE, ...message }, window.location.origin)

  const isAppMessage = (event) =>
    event.source === window &&
    typeof event.data === 'object' &&
    event.data !== null &&
    event.data.source === APP_SOURCE

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return
    if (!isAppMessage(event)) return
    if (!alive()) {
      reply({ type: 'ERROR', message: 'The extension was reloaded. Reload this page and try again.' })
      return
    }

    if (event.data.type === 'PING') {
      reply({ type: 'HELLO', version: VERSION })
      return
    }

    if (event.data.type !== 'REQUEST_INVENTORY') return

    // The service worker owns the store, so it is the one asked.
    globalThis.chrome.runtime.sendMessage({ type: 'get' }, (response) => {
      const captures = Array.isArray(response?.captures) ? response.captures : []
      if (captures.length === 0) {
        reply({
          type: 'ERROR',
          message:
            'Nothing captured yet. Open chainers.io, let your farm and inventory load once, then come back.',
        })
        return
      }

      const payload = globalThis.BioplotParse.toPayload(captures)
      if (payload.seeds.length === 0 && payload.plots.length === 0) {
        // Naming what IS stored turns a dead end into something the player can act on:
        // usually the farm endpoints are simply absent because the farm was never opened.
        const paths = [
          ...new Set(
            captures.map((capture) =>
              capture.url.split('?')[0].replace('https://chainers.io', ''),
            ),
          ),
        ]
        const farm = paths.filter((path) => path.startsWith('/api/farm/user/'))

        reply({
          type: 'ERROR',
          message:
            farm.length === 0
              ? `No farm data captured yet. ${captures.length} responses stored, none of them /api/farm/user/*. Open chainers.io, enter the farm, then reload this page and sync again.`
              : `Captured ${farm.join(' and ')} but recognised no rows. Use "Copy diagnostics" in the extension popup and open an issue.`,
        })
        return
      }

      reply({ type: 'INVENTORY', payload })
    })
  })

  // Announce on load so the app can show its status without asking.
  reply({ type: 'HELLO', version: VERSION })
})()
