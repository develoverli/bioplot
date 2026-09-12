import {
  HISTORY_BLOCKS,
  blockCurrency,
  blockKey,
  explorerApi,
  findVault,
  readVault,
  settledCloses,
  tokenFor,
  type MarketBlock,
  type TokenTx,
  type WeightLookup,
} from './chain'
import { deleteBlocks, loadBlocks, saveBlock } from './chainDb'
import type { Pools } from './types'

/**
 * Filling the window, block by block, from the explorer.
 *
 * Three calls settle one block: the chain block at the moment it opened, the currency
 * transfers just after that moment (the funding names the vault), and the vault's own
 * transfer list (crops in, payouts out). The first run reads fifty blocks a currency and
 * takes a while; after that it is three calls every four hours. Every finished block is
 * saved before the next starts, so closing the tab loses at most one block of work.
 */

export interface SyncProgress {
  currency: string
  done: number
  total: number
  /** Blocks the chain would not give up: no funding matched, or the explorer failed. */
  skipped: number
}

export type ProgressListener = (progress: SyncProgress) => void

export interface SyncOptions {
  pools: Pools
  weightOf: WeightLookup
  window?: number
  signal?: AbortSignal
  onProgress?: ProgressListener
  onBlock?: (block: MarketBlock) => void
  fetchJson?: (url: string, signal?: AbortSignal) => Promise<unknown>
}

/** A block the explorer is slow to serve is not an error: the window fills on the next pass. */
const RETRIES = 2
const PAUSE_MS = 250
/** Payout bursts and fundings sit within a minute of the boundary; two hundred blocks is generous. */
const FUNDING_SPAN = 200

async function defaultFetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let last: unknown = null
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { signal, headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`explorer answered ${response.status}`)
      return await response.json()
    } catch (error) {
      if (signal?.aborted) throw error
      last = error
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
  throw last instanceof Error ? last : new Error('explorer unreachable')
}

function isTokenTxList(value: unknown): value is { result: TokenTx[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { result?: unknown }).result)
  )
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })
}

async function blockNumberAt(
  fetchJson: NonNullable<SyncOptions['fetchJson']>,
  unixSeconds: number,
  closest: 'before' | 'after',
  signal?: AbortSignal,
): Promise<number | null> {
  const answer = (await fetchJson(explorerApi.blockAt(unixSeconds, closest), signal)) as {
    result?: { blockNumber?: string }
  }
  const number = Number(answer?.result?.blockNumber)
  return Number.isFinite(number) && number > 0 ? number : null
}

async function vaultRows(
  fetchJson: NonNullable<SyncOptions['fetchJson']>,
  vault: string,
  signal?: AbortSignal,
): Promise<TokenTx[]> {
  const rows: TokenTx[] = []
  for (let page = 1; page <= 5; page += 1) {
    const answer = await fetchJson(explorerApi.addressTransfers(vault, page), signal)
    if (!isTokenTxList(answer)) break
    rows.push(...answer.result)
    if (answer.result.length < 10_000) break
  }
  return rows
}

/** Reads one settled block: its vault, then everything the vault saw. Null when the chain does not agree. */
async function readSettledBlock(
  fetchJson: NonNullable<SyncOptions['fetchJson']>,
  currency: string,
  closeAt: string,
  blockTimeSeconds: number,
  payoutRaw: number,
  weightOf: WeightLookup,
  signal?: AbortSignal,
): Promise<MarketBlock | null> {
  const token = tokenFor(currency)
  if (!token) return null

  const openSeconds = Date.parse(closeAt) / 1000 - blockTimeSeconds
  const start = await blockNumberAt(fetchJson, openSeconds - 30, 'after', signal)
  if (start === null) return null
  await pause(PAUSE_MS, signal)

  const funding = await fetchJson(
    explorerApi.tokenTransfers(token.address, start, start + FUNDING_SPAN),
    signal,
  )
  if (!isTokenTxList(funding)) return null
  const vault = findVault(funding.result, token.address, payoutRaw)
  if (!vault) return null
  await pause(PAUSE_MS, signal)

  const rows = await vaultRows(fetchJson, vault, signal)
  if (rows.length === 0) return null
  const block = readVault(rows, vault, currency, weightOf)
  // The chain's own close time can drift a few seconds from the schedule; the schedule is the key.
  return { ...block, key: blockKey(currency, closeAt), closeAt }
}

/**
 * Brings one currency's window up to date. Resolves with every block now in the window.
 *
 * The live block tells us the tier's payout, the schedule, and the block length; the rest is
 * arithmetic and the explorer.
 */
export async function syncCurrency(options: SyncOptions, currency: string): Promise<MarketBlock[]> {
  const { pools, weightOf, signal } = options
  const fetchJson = options.fetchJson ?? defaultFetchJson
  const window = options.window ?? HISTORY_BLOCKS

  const live = pools.blocks.find((block) => blockCurrency(pools, block) === currency)
  const group = pools.groups.find((candidate) => candidate.groupCode === live?.groupCode)
  const blockTimeSeconds = group?.blockTimeSeconds ?? 14_400
  if (!live || live.payout <= 0) return []

  const closes = settledCloses(live.endDate, blockTimeSeconds, window)
  const wanted = new Set(closes.map((closeAt) => blockKey(currency, closeAt)))

  const cached = await loadBlocks(currency)
  const stale = cached.filter((block) => !wanted.has(block.key)).map((block) => block.key)
  await deleteBlocks(stale)
  const have = new Map(cached.filter((block) => wanted.has(block.key)).map((block) => [block.key, block]))

  const missing = closes.filter((closeAt) => !have.has(blockKey(currency, closeAt)))
  let done = 0
  let skipped = 0
  const report = () =>
    options.onProgress?.({ currency, done, total: missing.length, skipped })
  report()

  for (const closeAt of missing) {
    if (signal?.aborted) break
    try {
      const block = await readSettledBlock(
        fetchJson,
        currency,
        closeAt,
        blockTimeSeconds,
        live.payout,
        weightOf,
        signal,
      )
      if (block) {
        await saveBlock(block)
        have.set(block.key, block)
        options.onBlock?.(block)
      } else {
        skipped += 1
      }
    } catch (error) {
      if (signal?.aborted) break
      skipped += 1
      void error
    }
    done += 1
    report()
    await pause(PAUSE_MS, signal).catch(() => undefined)
  }

  return [...have.values()]
}

/** When the next settled block can be read: the live close plus the grace the payouts need. */
export function nextSyncAt(pools: Pools, graceMs: number): number | null {
  const ends = pools.blocks
    .map((block) => Date.parse(block.endDate))
    .filter((end) => Number.isFinite(end))
  if (ends.length === 0) return null
  const soonest = Math.min(...ends)
  const now = Date.now()
  // The capture may be old: roll the schedule forward to the next close from now.
  const group = pools.groups[0]
  const step = (group?.blockTimeSeconds ?? 14_400) * 1000
  let at = soonest
  while (at + graceMs <= now) at += step
  return at + graceMs
}
