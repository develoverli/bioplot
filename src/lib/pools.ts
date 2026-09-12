import type { PoolPayout, Pools } from './types'

/**
 * What the pools have actually paid, and when it pays best.
 *
 * A block splits a fixed payout by contributed weight, so the rate a biopoint earns in a block
 * is `blockPayout / totalWeight` — equivalently `payoutAmount / userWeight` for your own row.
 * That rate is not constant: it rises when few people contribute and falls when many do. Which
 * makes "when should I send my harvest" an answerable question rather than folklore.
 */
export interface CurrencyTotals {
  currency: string
  day: number
  week: number
  month: number
  all: number
  blocks: number
}

export interface HourRate {
  /** Local hour the block was settled, 0-23. */
  hour: number
  /** Currency per biopoint, averaged over the blocks in this hour. */
  rate: number
  blocks: number
}

export interface PoolHistory {
  totals: CurrencyTotals[]
  /** Best settling hours by rate, richest first. Only for the main currency. */
  hours: HourRate[]
  bestHours: HourRate[]
  mainCurrency: string | null
  /** Too few blocks to read anything into the hours. */
  thin: boolean
  count: number
}

const DAY = 86_400_000

function since(payouts: PoolPayout[], currency: string, ms: number): number {
  const cutoff = Date.now() - ms
  return payouts
    .filter((payout) => payout.currency === currency && Date.parse(payout.created) >= cutoff)
    .reduce((sum, payout) => sum + payout.amount, 0)
}

/** Currency per biopoint for one settled block. */
export function rateOf(payout: PoolPayout): number {
  if (payout.userWeight > 0) return payout.amount / payout.userWeight
  if (payout.totalWeight > 0) return payout.amount / payout.totalWeight
  return 0
}

export function buildPoolHistory(pools: Pools): PoolHistory {
  const payouts = pools.payouts.filter((payout) => payout.currency)

  const currencies = [...new Set(payouts.map((payout) => payout.currency))]
  const totals: CurrencyTotals[] = currencies
    .map((currency) => ({
      currency,
      day: since(payouts, currency, DAY),
      week: since(payouts, currency, 7 * DAY),
      month: since(payouts, currency, 30 * DAY),
      all: payouts
        .filter((payout) => payout.currency === currency)
        .reduce((sum, payout) => sum + payout.amount, 0),
      blocks: payouts.filter((payout) => payout.currency === currency).length,
    }))
    .sort((a, b) => b.blocks - a.blocks)

  // Hours are only comparable within one currency, so the busiest one speaks for the farm.
  const mainCurrency = totals[0]?.currency ?? null
  const buckets = new Map<number, { total: number; blocks: number }>()

  for (const payout of payouts) {
    if (payout.currency !== mainCurrency) continue
    const at = Date.parse(payout.created)
    if (Number.isNaN(at)) continue

    const hour = new Date(at).getHours()
    const bucket = buckets.get(hour) ?? { total: 0, blocks: 0 }
    bucket.total += rateOf(payout)
    bucket.blocks += 1
    buckets.set(hour, bucket)
  }

  const hours: HourRate[] = [...buckets.entries()]
    .map(([hour, bucket]) => ({ hour, rate: bucket.total / bucket.blocks, blocks: bucket.blocks }))
    .sort((a, b) => a.hour - b.hour)

  const bestHours = [...hours].sort((a, b) => b.rate - a.rate).slice(0, 3)

  return {
    totals,
    hours,
    bestHours,
    mainCurrency,
    // Six blocks is a day's worth. Below that, an "best hour" is noise wearing a hat.
    thin: payouts.length < 6,
    count: payouts.length,
  }
}
