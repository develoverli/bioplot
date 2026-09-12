import { importPayloadSchema, type ImportPayload } from './inventory'

/**
 * Handshake with the companion extension.
 *
 * The extension reads the farm inventory inside the player's own browser and posts it to
 * this page. No token, cookie, or credential is ever part of the message, and this app
 * never talks to the game API itself.
 */
export const APP_SOURCE = 'bioplot'
export const EXTENSION_SOURCE = 'bioplot-extension'

export type BridgeMessage =
  | { source: typeof EXTENSION_SOURCE; type: 'HELLO'; version: string }
  | { source: typeof EXTENSION_SOURCE; type: 'INVENTORY'; payload: unknown }
  | { source: typeof EXTENSION_SOURCE; type: 'ERROR'; message: string }

function isBridgeMessage(data: unknown): data is BridgeMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === EXTENSION_SOURCE
  )
}

/** Resolves once the extension announces itself, or false if it never does. */
export function detectExtension(timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !isBridgeMessage(event.data)) return
      if (event.data.type !== 'HELLO') return
      finish(true)
    }

    const finish = (found: boolean) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      resolve(found)
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ source: APP_SOURCE, type: 'PING' }, window.location.origin)
    const timer = window.setTimeout(() => finish(false), timeoutMs)
  })
}

export class BridgeError extends Error {}

/** Asks the extension for the current inventory capture. */
export function requestInventory(timeoutMs = 5000): Promise<ImportPayload> {
  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !isBridgeMessage(event.data)) return

      if (event.data.type === 'ERROR') {
        settled = true
        cleanup()
        reject(new BridgeError(event.data.message))
        return
      }

      if (event.data.type !== 'INVENTORY') return

      const parsed = importPayloadSchema.safeParse(event.data.payload)
      settled = true
      cleanup()
      if (parsed.success) resolve(parsed.data)
      else reject(new BridgeError('The extension sent a payload this app does not understand.'))
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ source: APP_SOURCE, type: 'REQUEST_INVENTORY' }, window.location.origin)

    const timer = window.setTimeout(() => {
      if (settled) return
      cleanup()
      reject(
        new BridgeError(
          'No answer from the extension. Open chainers.io, load your farm once, then try again.',
        ),
      )
    }, timeoutMs)
  })
}

/**
 * A short signature of what a capture actually says.
 *
 * `capturedAt` is stamped when the payload is built, so it changes on every poll and cannot
 * answer "is this different from what I am looking at". Hashing the parts the app plans on
 * can: plant a seed in the game and the signature moves, poll twice with nothing changed and
 * it does not.
 */
export function fingerprint(payload: ImportPayload): string {
  const material = JSON.stringify([
    payload.gardens,
    payload.seeds,
    payload.plots,
    payload.items,
    payload.pools.blocks,
  ])

  let hash = 2166136261
  for (let i = 0; i < material.length; i++) {
    hash ^= material.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
