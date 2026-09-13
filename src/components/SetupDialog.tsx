import { useCallback, useEffect, useState } from 'react'
import { Check, Download, ExternalLink, PlugZap, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { countArtwork } from '../lib/artwork'
import { BridgeError, detectExtension, fingerprint, requestInventory } from '../lib/bridge'
import { fromImportPayload, importPayloadSchema, type ImportResult } from '../lib/inventory'
import { EXTENSION_URL, PRIVACY_URL, TERMS_URL } from '../lib/links'
import { useStore } from '../store'
import { Button, ButtonLink, Disclosure, Modal } from './ui'

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ok'; result: ImportResult }
  | { kind: 'error'; message: string }

function Step({ done, n, children }: { done: boolean; n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className={`tabular mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          done
            ? 'bg-accent text-[color:var(--accent-contrast)]'
            : 'border border-line-strong text-muted'
        }`}
      >
        {done ? <Check size={12} strokeWidth={3} /> : n}
      </span>
      <span className={done ? 'text-muted' : 'text-ink'}>{children}</span>
    </li>
  )
}

/**
 * Everything about getting data in, in one place.
 *
 * Loading a farm is a first-run job, not a daily one, so it does not deserve permanent space
 * on the page. The steps are numbered and tick themselves off as each one starts working.
 */
export function SetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setInventory = useStore((state) => state.setInventory)
  const setCatalogue = useStore((state) => state.setCatalogue)
  const inventory = useStore((state) => state.inventory)
  const reset = useStore((state) => state.reset)
  const setCaptureSignature = useStore((state) => state.setCaptureSignature)

  const [hasExtension, setHasExtension] = useState<boolean | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [pasted, setPasted] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    detectExtension().then((found) => {
      if (!cancelled) setHasExtension(found)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const apply = useCallback(
    (payload: unknown) => {
      const parsed = importPayloadSchema.safeParse(payload)
      if (!parsed.success) {
        setStatus({ kind: 'error', message: 'That does not look like a bioplot capture.' })
        return false
      }
      const result = fromImportPayload(parsed.data)
      setInventory(result.inventory)
      setCatalogue(result.catalogue)
      setCaptureSignature(fingerprint(parsed.data))
      setStatus({ kind: 'ok', result })
      return true
    },
    [setCaptureSignature, setCatalogue, setInventory],
  )

  const sync = useCallback(async () => {
    setStatus({ kind: 'working' })
    try {
      // A sync that brought a farm in is done: the page behind the dialog is the result.
      if (apply(await requestInventory())) onClose()
    } catch (error) {
      setStatus({
        kind: 'error',
        message:
          error instanceof BridgeError
            ? error.message
            : 'Could not reach the extension. Is it installed and enabled?',
      })
    }
  }, [apply, onClose])

  const exportInventory = useCallback(() => {
    const blob = new Blob([JSON.stringify(inventory, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'bioplot-farm.json'
    link.click()
    URL.revokeObjectURL(url)
  }, [inventory])

  const loaded = inventory.gardens.length > 0
  const plots = inventory.gardens.reduce((sum, garden) => sum + garden.beds.length, 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Load your farm"
      footer={
        <>
          <Button variant="danger" onClick={reset}>
            <RotateCcw size={15} aria-hidden="true" />
            Reset everything
          </Button>
          <Button onClick={exportInventory}>
            <Download size={15} aria-hidden="true" />
            Export
          </Button>
          <Button variant="primary" onClick={sync} disabled={status.kind === 'working'}>
            <PlugZap size={16} aria-hidden="true" />
            {status.kind === 'working' ? 'Syncing…' : 'Sync now'}
          </Button>
        </>
      }
    >
      <ol className="flex flex-col gap-2.5 text-sm">
        <Step done={hasExtension === true} n={1}>
          {hasExtension === true ? (
            <>
              <strong>Bioplot Farm Reader</strong> is installed and answering on this page.
            </>
          ) : (
            <span className="flex flex-col items-start gap-2">
              <span>
                Add <strong>Bioplot Farm Reader</strong> from the Chrome Web Store, then reload
                this page.
              </span>
              <ButtonLink href={EXTENSION_URL}>
                Add to Chrome
                <ExternalLink size={15} aria-hidden="true" className="text-muted" />
                <span className="sr-only">(opens the Chrome Web Store in a new tab)</span>
              </ButtonLink>
            </span>
          )}
        </Step>
        <Step done={loaded} n={2}>
          Go to <strong>chainers.io</strong> and reload the farm page. Loading the farm is all the
          capture needs: plots, seeds, animals, recipes and the pools come with it.
        </Step>
        <Step done={loaded} n={3}>
          Come back here and hit <strong>Sync now</strong>.
        </Step>
      </ol>

      <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        <ShieldCheck size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
        No session token, cookie, or password reaches this page or any server. The extension is
        read-only: it never plants, harvests, buys, or signs anything.
      </p>

      {loaded ? (
        <p className="mt-3 text-sm text-ink">
          <span className="font-medium text-accent">Farm loaded.</span> {plots} plots across{' '}
          {inventory.gardens.length} land{inventory.gardens.length === 1 ? '' : 's'}, and{' '}
          {inventory.seeds.length} seed stacks.
        </p>
      ) : null}

      {status.kind === 'ok' ? (
        <div className="mt-3 text-sm">
          <p className="text-ink">
            Imported <span className="tabular font-medium text-accent">{status.result.matched}</span>{' '}
            rows.
          </p>
          {countArtwork(status.result.catalogue) > 0 ? (
            <p className="mt-1 text-xs text-faint">
              {countArtwork(status.result.catalogue)} sprites and the game&apos;s own biopoint weights
              came with it.
            </p>
          ) : null}
          {status.result.inventory.gardens.length === 0 ? (
            <p className="mt-1 text-xs text-[color:var(--warning)]">
              No farm layout in this capture. Reload the extension, then reload the farm page in
              chainers.io and sync again.
            </p>
          ) : null}
        </div>
      ) : null}

      {status.kind === 'error' ? (
        <p role="alert" className="mt-3 text-sm text-[color:var(--danger)]">
          {status.message}
        </p>
      ) : null}

      {hasExtension === false ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted">
          <X size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--danger)]" />
          <span>
            Extension not detected on this page.{' '}
            <a href={EXTENSION_URL} target="_blank" rel="noreferrer noopener">
              Install it from the Chrome Web Store
            </a>
            , or enable it if it is already installed, then reload this tab.
          </span>
        </p>
      ) : null}

      <p className="mt-3 text-xs text-faint">
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer noopener">
          Privacy
        </a>
        <span className="mx-2">·</span>
        <a href={TERMS_URL} target="_blank" rel="noreferrer noopener">
          Terms
        </a>
      </p>

      <Disclosure summary="Paste a capture instead">
        <p className="mb-2 text-sm text-muted">
          Open the extension popup, copy the capture, and paste it here. Useful when the extension
          and this page live in different browsers.
        </p>
        <textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          rows={5}
          spellCheck={false}
          aria-label="Capture JSON"
          className="tabular w-full rounded-lg border border-line bg-surface p-2 text-xs text-ink"
          placeholder='{ "version": 1, "source": "bioplot-extension", "seeds": [], "plots": [] }'
        />
        <Button
          className="mt-2"
          disabled={pasted.trim().length === 0}
          onClick={() => {
            try {
              if (apply(JSON.parse(pasted))) setPasted('')
            } catch {
              setStatus({ kind: 'error', message: 'That is not valid JSON.' })
            }
          }}
        >
          Import pasted capture
        </Button>
      </Disclosure>
    </Modal>
  )
}
