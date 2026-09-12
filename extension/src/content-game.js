/**
 * Runs on chainers.io in the extension's isolated world, once per frame.
 *
 * Its whole job is to forward what the page-context observer saw to the service worker,
 * which is the only thing allowed to write storage. Keeping this script stateless is what
 * stops the farm iframe and the top frame from overwriting each other's findings.
 *
 * No network call, no page modification, no credential ever touches this file.
 */
;(() => {
  const CHANNEL = 'bioplot:capture'
  const SEEN_CHANNEL = 'bioplot:seen'

  /**
   * Reloading the extension orphans the content scripts already running in open tabs: their
   * `chrome` APIs still exist but throw "Extension context invalidated" on use. Checking for
   * a runtime id first keeps an orphaned script quiet instead of spraying errors into the
   * game's console until the tab is reloaded.
   */
  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id)
    } catch {
      return false
    }
  }

  const send = (message) => {
    try {
      // No response is expected; a rejected promise here is not worth surfacing.
      const sending = chrome.runtime.sendMessage(message)
      if (sending && typeof sending.catch === 'function') sending.catch(() => {})
    } catch {
      // The extension was reloaded mid-flight. The next page load starts clean.
    }
  }

  const isOurMessage = (event) =>
    event.source === window &&
    typeof event.data === 'object' &&
    event.data !== null &&
    (event.data.channel === CHANNEL || event.data.channel === SEEN_CHANNEL)

  window.addEventListener('message', (event) => {
    if (!isOurMessage(event) || !alive()) return

    const url = String(event.data.url ?? '')
    if (!url) return
    const at = Number(event.data.at) || Date.now()

    if (event.data.channel === SEEN_CHANNEL) {
      send({
        type: 'seen',
        url,
        bytes: Number(event.data.bytes) || 0,
        kind: String(event.data.kind ?? ''),
        at,
      })
      return
    }

    const body = String(event.data.body ?? '')
    if (!body) return
    send({ type: 'capture', url, body, at })
  })
})()
