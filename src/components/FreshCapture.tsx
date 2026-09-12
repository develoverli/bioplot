import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { fingerprint, requestInventory } from '../lib/bridge'
import { fromImportPayload, type ImportPayload } from '../lib/inventory'
import { useStore } from '../store'

/** How often to ask the extension whether the farm has moved on. */
const POLL_MS = 60_000

/**
 * "Your farm changed" — offered, never forced.
 *
 * The game keeps running after a capture: crops finish, feed gets crafted, plots get replanted.
 * Reloading behind the player's back would move the plan under their cursor, and making them
 * clear everything and re-import is a heavy answer to a small change. So the page notices, says
 * so, and waits to be asked.
 *
 * Polling is a local `postMessage` to the extension, never a request to the game.
 */
export function FreshCapture() {
  const loaded = useStore((state) => state.captureSignature)
  const hasFarm = useStore((state) => state.inventory.gardens.length > 0)
  const setInventory = useStore((state) => state.setInventory)
  const setCatalogue = useStore((state) => state.setCatalogue)
  const setCaptureSignature = useStore((state) => state.setCaptureSignature)

  const [fresh, setFresh] = useState<ImportPayload | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!hasFarm || !loaded) return
    let cancelled = false

    const check = async () => {
      // Nothing to compare against while the tab is in the background, and no reason to ask.
      if (document.visibilityState !== 'visible') return
      try {
        const payload = await requestInventory(4000)
        if (cancelled) return
        setFresh(fingerprint(payload) === loaded ? null : payload)
      } catch {
        // The extension being absent or busy is not an error worth showing: the page already
        // has a farm, and this is an offer, not a requirement.
      }
    }

    void check()
    const timer = window.setInterval(() => void check(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hasFarm, loaded])

  const refresh = useCallback(() => {
    if (!fresh) return
    setApplying(true)
    const result = fromImportPayload(fresh)
    setInventory(result.inventory)
    setCatalogue(result.catalogue)
    setCaptureSignature(fingerprint(fresh))
    setFresh(null)
    setApplying(false)
  }, [fresh, setCaptureSignature, setCatalogue, setInventory])

  if (!fresh) return null
  const signature = fingerprint(fresh)
  if (dismissed === signature) return null

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[color:var(--accent)] bg-accent-dim px-3.5 py-2.5"
    >
      <RefreshCw size={16} aria-hidden="true" className="text-accent" />
      <output className="text-sm text-ink">
        Your farm has changed since this plan was made.
      </output>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          disabled={applying}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-[color:var(--accent-contrast)] transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setDismissed(signature)}
          aria-label="Keep the current plan"
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
