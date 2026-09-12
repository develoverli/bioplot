/**
 * Page-context observer.
 *
 * Runs in the game's own JavaScript world so it can see the responses the game already
 * asks for. It NEVER issues a request of its own, never touches cookies, tokens or
 * headers, and always returns the untouched response to the game.
 *
 * Anything it notices is forwarded to the extension's content script by postMessage.
 * That is the only thing it does.
 */
;(() => {
  const CHANNEL = 'bioplot:capture'
  const SEEN_CHANNEL = 'bioplot:seen'
  // The farm catalogues are large: /api/farm/data/seeds alone is ~600 KB. Cutting below that
  // would silently drop the very payloads that carry the real growth times and biopoints.
  const MAX_BODY = 2 * 1024 * 1024

  // Endpoints that poll constantly and never carry inventory. Skipping them keeps the
  // capture slots for payloads that might actually contain seeds or plots.
  const NOISE = /(notification|tutorial|events-updates-status|battle-pass|analytics|telemetry|heartbeat|ping)/i

  const isInteresting = (url) => {
    try {
      const parsed = new URL(url, window.location.href)
      if (!parsed.hostname.endsWith('chainers.io')) return false
      if (!parsed.pathname.startsWith('/api/')) return false
      return !NOISE.test(parsed.pathname)
    } catch {
      return false
    }
  }

  /** The message type of a socket frame, if it announces one. Cheap and failure-tolerant. */
  const commandOf = (body) => {
    if (body.length > 200_000 || body.trimStart()[0] !== '{') return ''
    try {
      const parsed = JSON.parse(body)
      const raw =
        parsed?.command ?? parsed?.type ?? parsed?.event ?? parsed?.value?.command ?? ''
      if (typeof raw === 'string' && raw.length > 0 && raw.length <= 64) {
        return raw.replace(/[^A-Za-z0-9_.:-]/g, '')
      }
    } catch {
      // Not JSON, or not shaped that way. The frame still gets stored under "frame".
    }
    return ''
  }

  /**
   * Records that a call happened, even when its body is skipped. Without this there is no way
   * to tell "the endpoint was never called" apart from "the body was filtered out", and those
   * two need completely different fixes.
   */
  const noteSeen = (url, bytes, kind) => {
    window.postMessage(
      { channel: SEEN_CHANNEL, url, bytes, kind, at: Date.now() },
      window.location.origin,
    )
  }

  const report = (url, body) => {
    if (typeof body !== 'string' || body.length === 0 || body.length > MAX_BODY) return
    const trimmed = body.trimStart()
    // Only structured payloads are useful; HTML and images are noise.
    if (trimmed[0] !== '{' && trimmed[0] !== '[') return
    window.postMessage({ channel: CHANNEL, url, body, at: Date.now() }, window.location.origin)
  }

  const originalFetch = window.fetch
  if (typeof originalFetch === 'function') {
    window.fetch = function patchedFetch(...args) {
      const promise = originalFetch.apply(this, args)
      promise
        .then((response) => {
          const url = response?.url || (typeof args[0] === 'string' ? args[0] : args[0]?.url)
          if (!url || !isInteresting(url)) return
          // Read a clone so the game still gets an unconsumed body.
          response
            .clone()
            .text()
            .then((body) => {
              noteSeen(url, body.length, `fetch ${response.status}`)
              if (response.ok) report(url, body)
            })
            .catch(() => {})
        })
        .catch(() => {})
      return promise
    }
  }

  // A live farm may push its state over a socket rather than fetch it. Same rule applies:
  // listen to what already arrives, send nothing, alter nothing.
  const OriginalWebSocket = window.WebSocket
  if (typeof OriginalWebSocket === 'function') {
    const PatchedWebSocket = function (url, protocols) {
      const socket = protocols === undefined
        ? new OriginalWebSocket(url)
        : new OriginalWebSocket(url, protocols)

      socket.addEventListener('message', (event) => {
        try {
          if (typeof event.data !== 'string') return
          const parsed = new URL(url, window.location.href)
          if (!parsed.hostname.endsWith('chainers.io')) return
          // A socket carries many message types down one path. Naming the frame after its
          // command is what keeps the farm state from being overwritten by a heartbeat.
          const named = `ws://${parsed.hostname}/${commandOf(event.data) || 'frame'}`
          noteSeen(named, event.data.length, 'socket')
          report(named, event.data)
        } catch {
          // Never let the observer break the game.
        }
      })

      return socket
    }

    PatchedWebSocket.prototype = OriginalWebSocket.prototype
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      PatchedWebSocket[key] = OriginalWebSocket[key]
    }
    window.WebSocket = PatchedWebSocket
  }

  const OriginalXHR = window.XMLHttpRequest
  if (typeof OriginalXHR === 'function') {
    const open = OriginalXHR.prototype.open
    OriginalXHR.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__cppUrl = url
      return open.call(this, method, url, ...rest)
    }

    const send = OriginalXHR.prototype.send
    OriginalXHR.prototype.send = function patchedSend(...args) {
      this.addEventListener('load', () => {
        try {
          const url = this.__cppUrl
          if (!url || !isInteresting(url)) return
          if (this.responseType && this.responseType !== 'text' && this.responseType !== 'json') {
            noteSeen(url, 0, `xhr ${this.status} ${this.responseType}`)
            return
          }
          const body =
            this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText
          noteSeen(url, body ? body.length : 0, `xhr ${this.status}`)
          report(url, body)
        } catch {
          // Never let the observer break the game.
        }
      })
      return send.apply(this, args)
    }
  }
})()
