/**
 * The single owner of stored captures.
 *
 * Content scripts run once per frame, and the farm lives in an iframe. When each of those
 * frames kept its own list and wrote the whole thing back to chrome.storage.local, the last
 * frame to write erased what the others had found: the farm endpoints would appear and then
 * vanish depending on which frame flushed last.
 *
 * There is exactly one service worker, so making it the only writer removes the race. Content
 * scripts now just forward what they saw and never touch storage.
 */
const STORAGE_KEY = 'captures'
const SEEN_KEY = 'seen'
const MAX_CAPTURES = 60
const MAX_SEEN = 200
// chrome.storage.local allows 10 MB; staying under it keeps writes from failing silently
// once the big farm catalogues start landing.
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const WRITE_DELAY_MS = 500

let captures = null
let seen = null
let loading = null
let writeTimer = 0

/** The service worker can be torn down at any time, so state is reloaded on demand. */
async function ensureLoaded() {
  if (captures !== null) return
  if (loading === null) {
    loading = chrome.storage.local
      .get({ [STORAGE_KEY]: [], [SEEN_KEY]: {} })
      .then((stored) => {
        captures = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : []
        seen =
          stored[SEEN_KEY] && typeof stored[SEEN_KEY] === 'object' ? stored[SEEN_KEY] : {}
      })
  }
  await loading
}

/**
 * One slot per endpoint: a later response is simply fresher. Socket frames are already named
 * after their command, so the same rule holds. Only frames that announced no command fall
 * back to keying on the head of the body, so several unnamed shapes survive.
 */
const slotFor = (capture) =>
  capture.url.endsWith('/frame') ? `${capture.url}#${capture.body.slice(0, 80)}` : capture.url

function addCapture(capture) {
  const slot = slotFor(capture)
  const next = [...captures.filter((entry) => slotFor(entry) !== slot), capture]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_CAPTURES)

  // Newest first, so trimming to the byte budget drops the stalest payloads.
  let total = 0
  captures = next.filter((entry) => {
    total += entry.body.length
    return total <= MAX_TOTAL_BYTES
  })
}

function addSeen(item) {
  const key = item.url.split('?')[0]
  if (!key) return

  const previous = seen[key]
  if (previous) {
    previous.count += 1
    previous.bytes = item.bytes
    previous.kind = item.kind
    previous.at = item.at
    return
  }
  if (Object.keys(seen).length >= MAX_SEEN) return
  seen[key] = { bytes: item.bytes, kind: item.kind, count: 1, at: item.at }
}

function scheduleWrite() {
  if (writeTimer !== 0) return
  writeTimer = setTimeout(() => {
    writeTimer = 0
    chrome.storage.local.set({ [STORAGE_KEY]: captures, [SEEN_KEY]: seen })
  }, WRITE_DELAY_MS)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (typeof message !== 'object' || message === null) return undefined

  if (message.type === 'capture' || message.type === 'seen') {
    ensureLoaded().then(() => {
      if (message.type === 'capture') {
        addCapture({ url: message.url, body: message.body, at: message.at })
      } else {
        addSeen({ url: message.url, bytes: message.bytes, kind: message.kind, at: message.at })
      }
      scheduleWrite()
    })
    return undefined
  }

  if (message.type === 'get') {
    ensureLoaded().then(() => sendResponse({ captures, seen }))
    return true
  }

  if (message.type === 'clear') {
    captures = []
    seen = {}
    chrome.storage.local.set({ [STORAGE_KEY]: [], [SEEN_KEY]: {} }).then(() => sendResponse({ ok: true }))
    return true
  }

  return undefined
})
