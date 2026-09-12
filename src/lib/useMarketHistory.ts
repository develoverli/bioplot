import { useEffect, useMemo, useState } from 'react'
import {
  SETTLE_GRACE_MS,
  assessPools,
  blockCurrency,
  buildMarketHistory,
  buildWeightLookups,
  harvestWeight,
  tokenFor,
  type MarketBlock,
  type MarketHistory,
  type PoolAssessment,
} from './chain'
import { nextCloseAfter, type LiveReadings } from './chain'
import { loadBlocks } from './chainDb'
import { loadSnapshot, nextSyncAt, readOpenBlock, syncCurrency, type SyncProgress } from './chainSync'
import { PRICE_TTL_MS, fetchPrices, loadCachedPrices, loadManualPrices, priceOf, saveManualPrice, type Prices } from './prices'
import { useStore } from '../store'

export type MarketPhase = 'idle' | 'reading' | 'done' | 'failed'

export interface MarketState {
  currencies: string[]
  /** Currencies the capture names that this build cannot map to a token. */
  unknownCurrencies: string[]
  histories: Record<string, MarketHistory>
  ranked: PoolAssessment[]
  /** The harvest in the bag, in biopoints; null before an inventory has been synced. */
  bagWeight: number | null
  bagUnknown: string[]
  phase: MarketPhase
  progressDone: number
  progressTotal: number
  skipped: number
  lastRun: number | null
  nextRun: number | null
  snapshotAt: string | null
  snapshotBlocks: number
  now: number
  /** Live readings of the open blocks, off the chain. */
  readings: LiveReadings
  /** Coin prices in USD, fetched, plus the player's own reference prices for unlisted coins. */
  prices: Prices | null
  manualPrices: Record<string, number>
  /** USD per whole coin, or null. */
  priceOf: (currency: string) => number | null
  setManualPrice: (currency: string, usd: number | null) => void
  refresh: () => void
}

/** How often the open block's vault is re-read while the tab is open. */
const LIVE_READ_MS = 5 * 60_000

/**
 * Everything the pools tab knows about the market, in one hook.
 *
 * Loads the shared snapshot and the local cache, fills the gaps from the chain, re-arms
 * itself for the next close, and keeps a clock ticking for the countdowns. The components
 * only render; nothing in here touches the game.
 */
export function useMarketHistory(): MarketState {
  const pools = useStore((state) => state.inventory.pools)
  const items = useStore((state) => state.inventory.items)
  const catalogue = useStore((state) => state.catalogue)
  const lookups = useMemo(() => buildWeightLookups(catalogue), [catalogue])
  const weightOf = lookups.byTokenName
  const bag = useMemo(() => harvestWeight(items, lookups.byCode), [items, lookups])
  const bagWeight = items.length > 0 ? bag.weight : null

  const named = useMemo(
    () => [...new Set(pools.blocks.map((block) => blockCurrency(pools, block)))],
    [pools],
  )
  const currencies = useMemo(() => named.filter((c) => tokenFor(c)), [named])
  const unknownCurrencies = useMemo(
    () => named.filter((c) => !tokenFor(c)).map((c) => c || '(blank)'),
    [named],
  )

  const [blocks, setBlocks] = useState<Record<string, MarketBlock[]>>({})
  const [progress, setProgress] = useState<Record<string, SyncProgress>>({})
  const [phase, setPhase] = useState<MarketPhase>('idle')
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [nextRun, setNextRun] = useState<number | null>(null)
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null)
  const [snapshotBlocks, setSnapshotBlocks] = useState(0)
  const [manual, setManual] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [readings, setReadings] = useState<LiveReadings>({})
  const [prices, setPrices] = useState<Prices | null>(() => loadCachedPrices())
  const [manualPrices, setManualPrices] = useState<Record<string, number>>(() => loadManualPrices())

  // Prices every few minutes while the tab is open; a failed fetch keeps the last ones.
  useEffect(() => {
    const controller = new AbortController()
    const tick = () => void fetchPrices(controller.signal).then((next) => next && setPrices(next))
    tick()
    const timer = window.setInterval(tick, PRICE_TTL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])
  const lookupPrice = useMemo(
    () => (currency: string) => priceOf(currency, prices, manualPrices),
    [prices, manualPrices],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (currencies.length === 0) return
    const controller = new AbortController()
    let timer: number | undefined

    const run = async () => {
      setPhase('reading')
      const [cached, snapshot] = await Promise.all([
        Promise.all(currencies.map((currency) => loadBlocks(currency))),
        loadSnapshot(controller.signal),
      ])
      if (controller.signal.aborted) return
      setBlocks(Object.fromEntries(currencies.map((currency, i) => [currency, cached[i] ?? []])))
      setSnapshotAt(snapshot?.updatedAt ?? null)
      setSnapshotBlocks(snapshot?.blocks.length ?? 0)

      const results = await Promise.allSettled(
        currencies.map((currency) =>
          syncCurrency(
            {
              pools,
              weightOf,
              snapshot,
              signal: controller.signal,
              onProgress: (p) => setProgress((prev) => ({ ...prev, [currency]: p })),
              onBlock: (block) =>
                setBlocks((prev) => ({
                  ...prev,
                  [currency]: [...(prev[currency] ?? []).filter((b) => b.key !== block.key), block],
                })),
            },
            currency,
          ),
        ),
      )
      if (controller.signal.aborted) return
      setPhase(results.some((result) => result.status === 'rejected') ? 'failed' : 'done')
      setLastRun(Date.now())
      setProgress({})

      const next = nextSyncAt(pools, SETTLE_GRACE_MS)
      setNextRun(next)
      if (next !== null) {
        timer = window.setTimeout(() => void run(), Math.max(10_000, next - Date.now()))
      }
    }

    void run()
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [currencies, pools, weightOf, manual])

  // The open block's close per currency; when it moves, a new block has opened.
  const opens = useMemo(
    () =>
      currencies.map((currency) => {
        const live = pools.blocks.find((block) => blockCurrency(pools, block) === currency)
        const group = pools.groups.find((candidate) => candidate.groupCode === live?.groupCode)
        return live ? `${currency}:${nextCloseAfter(live.endDate, group?.blockTimeSeconds ?? 14_400, now)}` : ''
      }),
    [currencies, pools, now],
  )
  const opensKey = opens.join('|')

  // Read what the open blocks hold, straight off their vaults, and again every few minutes.
  useEffect(() => {
    if (currencies.length === 0) return
    const controller = new AbortController()
    let timer: number | undefined

    const read = async () => {
      for (const key of opensKey.split('|')) {
        const [currency, closesAt] = key.split(/:(.+)/) as [string, string | undefined]
        if (!currency || !closesAt || controller.signal.aborted) continue
        try {
          const reading = await readOpenBlock({ pools, weightOf, signal: controller.signal }, currency, closesAt)
          if (controller.signal.aborted) return
          setReadings((prev) => ({ ...prev, [currency]: reading ?? prev[currency] }))
        } catch {
          // A vault that will not read yet is not an error: the capture, or the schedule, carries on.
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void read(), LIVE_READ_MS)
    }

    void read()
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [currencies, pools, weightOf, opensKey, manual])

  const histories = useMemo(
    () =>
      Object.fromEntries(
        currencies.map((currency) => [currency, buildMarketHistory(currency, blocks[currency] ?? [])]),
      ) as Record<string, MarketHistory>,
    [currencies, blocks],
  )
  const ranked = useMemo(
    () => assessPools(pools, histories, bagWeight ?? 0, now, readings, lookupPrice),
    [pools, histories, bagWeight, now, readings, lookupPrice],
  )

  const progressDone = Object.values(progress).reduce((sum, p) => sum + p.done, 0)
  const progressTotal = Object.values(progress).reduce((sum, p) => sum + p.total, 0)
  const skipped = Object.values(progress).reduce((sum, p) => sum + p.skipped, 0)

  return {
    currencies,
    unknownCurrencies,
    histories,
    ranked,
    bagWeight,
    bagUnknown: bag.unknown,
    phase,
    progressDone,
    progressTotal,
    skipped,
    lastRun,
    nextRun,
    snapshotAt,
    snapshotBlocks,
    now,
    readings,
    prices,
    manualPrices,
    priceOf: lookupPrice,
    setManualPrice: (currency, usd) => setManualPrices(saveManualPrice(currency, usd)),
    refresh: () => setManual((n) => n + 1),
  }
}
