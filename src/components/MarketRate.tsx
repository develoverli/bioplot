import { useEffect, useMemo, useState } from 'react'
import { Clock, ExternalLink, RefreshCw, Send, TableProperties } from 'lucide-react'
import {
  HISTORY_BLOCKS,
  SEND_WINDOW_MS,
  SETTLE_GRACE_MS,
  assessPools,
  blockCurrency,
  buildMarketHistory,
  buildWeightLookups,
  estimateEarnings,
  explorerApi,
  harvestWeight,
  rateOfBlock,
  tokenFor,
  type MarketBlock,
  type MarketHistory,
  type PoolAssessment,
  type SlotStat,
} from '../lib/chain'
import { loadBlocks } from '../lib/chainDb'
import { nextSyncAt, syncCurrency, type SyncProgress } from '../lib/chainSync'
import { formatBiopoints, formatDuration, formatExact } from '../lib/format'
import type { Pools } from '../lib/types'
import { useStore } from '../store'
import { Modal } from './ui'

const rateFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** A payout in the currency's own units, from the game's raw integers. */
function formatAmount(raw: number, currency: string): string {
  const value = raw / 10 ** (tokenFor(currency)?.decimals ?? 9)
  if (value === 0) return `0 ${currency}`
  if (value < 0.0001) return `<0.0001 ${currency}`
  return `${rateFormat.format(value)} ${currency}`
}

/** "7.46 CFB per 1M bp": the scale at which a rate stops being dust. */
function formatRate(rate: number, currency: string): string {
  const decimals = tokenFor(currency)?.decimals ?? 9
  return `${rateFormat.format((rate / 10 ** decimals) * 1_000_000)} ${currency}`
}

function formatIndex(index: number): string {
  const delta = Math.round((index - 1) * 100)
  return `${delta > 0 ? '+' : ''}${delta}%`
}

/** The slot's closing time as the clock shows it, using the live block's minute. */
function slotLabel(hour: number, minute: number): string {
  const at = new Date()
  at.setHours(hour, minute, 0, 0)
  return timeFormat.format(at)
}

function closesIn(endDate: string, now: number): number {
  const end = Date.parse(endDate)
  return Number.isFinite(end) ? Math.max(0, end - now) : 0
}

/**
 * The one paragraph the tab exists for.
 *
 * Bag, tier, the pool to send to, why (where its block sits against its own history), what
 * that would earn, and when to press the button. Alternatives follow so the choice is visible,
 * not hidden.
 */
function Recommendation({
  pools,
  ranked,
  bagWeight,
  now,
}: {
  pools: Pools
  ranked: PoolAssessment[]
  bagWeight: number | null
  now: number
}) {
  const top = ranked.find((entry) => entry.ready) ?? null
  const tier = pools.level ? `Tier ${pools.level.level + 1}` : 'your tier'

  if (!top) {
    return (
      <div className="mt-2.5 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
        <p className="text-sm font-semibold text-ink">No recommendation yet</p>
        <p className="mt-0.5 text-xs text-muted">
          A verdict needs a day of settled blocks per pool. The history is being read; come back
          in a few minutes.
        </p>
      </div>
    )
  }

  const minute = new Date(top.live.endDate).getMinutes()
  const left = closesIn(top.live.endDate, now)
  const sendNow = left <= SEND_WINDOW_MS
  const closeLabel = timeFormat.format(new Date(top.live.endDate))
  const vsUsual = top.slot ? formatIndex(top.crowd) : null

  return (
    <div className="mt-2.5 rounded-xl border border-[color:var(--accent)] bg-accent-dim px-3.5 py-3">
      <p className="tabular text-xs text-muted">
        {bagWeight !== null ? (
          <>
            Your bag holds{' '}
            <span className="font-semibold text-ink" title={formatExact(bagWeight)}>
              {formatBiopoints(bagWeight)} bp
            </span>{' '}
            of produce
          </>
        ) : (
          'Sync your inventory to weigh your bag'
        )}{' '}
        · {tier}
      </p>

      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-ink">
        <Send size={16} aria-hidden="true" className="text-accent" />
        Send to {top.currency}
        {bagWeight !== null && bagWeight > 0 ? (
          <span className="tabular text-accent">≈ {formatAmount(top.earn, top.currency)}</span>
        ) : null}
      </p>

      <p className="tabular mt-1 text-xs text-muted">
        Its block holds <span className="text-ink">{formatBiopoints(top.live.totalWeight)}</span> now and is
        expected to end near <span className="text-ink">{formatBiopoints(top.projected)}</span>
        {vsUsual ? ` (${vsUsual} vs this hour's usual)` : ''}. Over the last {top.history.complete} blocks
        the lightest ended at <span className="text-ink">{formatBiopoints(top.low)}</span> and the heaviest at{' '}
        <span className="text-ink">{formatBiopoints(top.high)}</span>: this one sits at{' '}
        <span className="font-semibold text-ink">{Math.round(top.position * 100)}%</span> of that range.
        Lower is better for you.
      </p>

      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-ink">
        <Clock size={13} aria-hidden="true" className={sendNow ? 'text-accent' : 'text-muted'} />
        {sendNow
          ? `Send now: the block closes at ${closeLabel}, in ${formatDuration(left / 1000)}.`
          : `Wait: closes at ${closeLabel}, in ${formatDuration(left / 1000)}. Send in the last ${SEND_WINDOW_MS / 60_000} minutes, when the weight is known and nobody can pile in after you.`}
      </p>

      {ranked.length > 1 ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line/60 pt-2 text-xs text-muted">
          {ranked
            .filter((entry) => entry !== top)
            .map((entry) => (
              <li key={entry.currency} className="tabular">
                <span className="font-medium text-ink">{entry.currency}</span>
                {entry.ready ? (
                  <>
                    {' '}
                    {bagWeight !== null && bagWeight > 0 ? `≈ ${formatAmount(entry.earn, entry.currency)} · ` : ''}
                    {Math.round(entry.position * 100)}% of its range
                    {entry.slot ? ` · ${formatIndex(entry.crowd)} vs usual` : ''}
                  </>
                ) : (
                  <span className="text-faint"> · reading history</span>
                )}
              </li>
            ))}
        </ul>
      ) : null}

      <p className="mt-2 text-xs text-faint">
        Pools are ranked against their own history, not against each other in value: the app has
        no prices and will not invent them. Earnings assume the block ends near its usual weight
        plus your bag; slot {slotLabel(new Date(top.live.endDate).getHours(), minute)} is compared
        with the same hour on past days.
      </p>
    </div>
  )
}

/**
 * One column per pool, one row per block, the live block on top: total contributed weight,
 * with the window's lightest block marked. The table a player scans to see where today sits.
 */
function WeightTable({ ranked, now, rows }: { ranked: PoolAssessment[]; now: number; rows: number }) {
  const currencies = ranked.map((entry) => entry.currency)
  const byCurrency = new Map(ranked.map((entry) => [entry.currency, entry]))
  const closes = [...new Set(ranked.flatMap((entry) => entry.history.blocks.map((block) => block.closeAt)))]
    .sort((a, b) => Date.parse(b) - Date.parse(a))
    .slice(0, rows)
  const lows = new Map(currencies.map((currency) => [currency, byCurrency.get(currency)?.low ?? 0]))
  const liveEnd = ranked[0]?.live.endDate ?? ''

  return (
    <div className="mt-3 overflow-x-auto scroll-thin">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="sr-only">Total contributed weight per block and pool</caption>
        <thead>
          <tr className="text-left text-xs tracking-wide text-faint uppercase">
            <th scope="col" className="py-1.5 pr-3 font-medium">Block closes</th>
            {currencies.map((currency) => (
              <th key={currency} scope="col" className="px-3 py-1.5 text-right font-medium">
                {currency}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          <tr className="bg-accent-dim/60">
            <td className="tabular py-1.5 pr-3 text-ink">
              <span className="font-semibold">Now</span>
              <span className="text-xs text-muted">
                {' '}
                · {liveEnd ? timeFormat.format(new Date(liveEnd)) : ''} · in{' '}
                {formatDuration(closesIn(liveEnd, now) / 1000)}
              </span>
            </td>
            {currencies.map((currency) => {
              const entry = byCurrency.get(currency)
              return (
                <td
                  key={currency}
                  className="tabular px-3 py-1.5 text-right text-ink"
                  title={entry ? formatExact(entry.live.totalWeight) : ''}
                >
                  {entry ? formatBiopoints(entry.live.totalWeight) : '—'}
                  {entry?.ready ? (
                    <span className="block text-xs text-faint">→ {formatBiopoints(entry.projected)}</span>
                  ) : null}
                </td>
              )
            })}
          </tr>
          {closes.map((closeAt) => (
            <tr key={closeAt}>
              <td className="tabular py-1.5 pr-3 text-muted">{dateTimeFormat.format(new Date(closeAt))}</td>
              {currencies.map((currency) => {
                const block = byCurrency.get(currency)?.history.blocks.find((b) => b.closeAt === closeAt)
                if (!block) {
                  return (
                    <td key={currency} className="px-3 py-1.5 text-right text-faint">
                      —
                    </td>
                  )
                }
                const rated = rateOfBlock(block) > 0
                const isLow = rated && block.totalWeight === lows.get(currency)
                return (
                  <td
                    key={currency}
                    className={`tabular px-3 py-1.5 text-right ${
                      isLow ? 'font-semibold text-accent' : rated ? 'text-ink' : 'text-faint'
                    }`}
                    title={
                      rated
                        ? `${formatExact(block.totalWeight)} · ${formatRate(rateOfBlock(block), currency)} per 1M bp`
                        : `incomplete: ${block.unknown.length} crop kinds unweighed`
                    }
                  >
                    {formatBiopoints(block.totalWeight)}
                    {!rated ? '*' : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-xs text-faint">
        Weight is total biopoints contributed by everyone in your tier. Green is the window's
        lightest block, the best a biopoint did. The arrow is the expected end of the live block. *
        means a crop in that block could not be weighed, so the number is a floor.
      </p>
    </div>
  )
}

/** Six bars, one per closing hour, the live one in the accent. Exact numbers sit in the table beside it. */
function SlotBars({
  slots,
  liveHour,
  minute,
  best,
}: {
  slots: SlotStat[]
  liveHour: number | null
  minute: number
  best: SlotStat | null
}) {
  const max = Math.max(...slots.map((slot) => slot.rate), 0)
  if (slots.length === 0 || max === 0) return null

  return (
    <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
      {slots.map((slot) => {
        const live = slot.hour === liveHour
        const isBest = best?.hour === slot.hour
        const height = Math.max(4, Math.round((slot.rate / max) * 56))
        return (
          <li key={slot.hour} className="flex flex-col items-center gap-1">
            <span className="tabular h-4 text-xs leading-4 text-muted">{isBest ? formatIndex(slot.index) : ''}</span>
            <span className="flex h-14 w-full items-end justify-center">
              <span
                aria-hidden="true"
                className={`w-full max-w-6 rounded-t-[4px] ${live ? 'bg-accent' : 'bg-surface-3'}`}
                style={{ height }}
              />
            </span>
            <span className={`tabular text-xs ${live || isBest ? 'font-semibold text-ink' : 'text-faint'}`}>
              {slotLabel(slot.hour, minute)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function HistoryModal({
  entry,
  bagWeight,
  onClose,
}: {
  entry: PoolAssessment | null
  bagWeight: number | null
  onClose: () => void
}) {
  const history = entry?.history ?? null
  const minute = entry ? new Date(entry.live.endDate).getMinutes() : 49
  const liveHour = entry ? new Date(entry.live.endDate).getHours() : null
  const showBag = bagWeight !== null && bagWeight > 0

  return (
    <Modal open={entry !== null} onClose={onClose} title={`${entry?.currency ?? ''} blocks, from the chain`} wide>
      {entry && history ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
            <div>
              <h3 className="text-sm font-semibold text-ink">By closing hour</h3>
              <p className="mt-0.5 text-xs text-muted">
                What a biopoint earned, averaged per slot. The live slot is green.
              </p>
              <div className="mt-3">
                <SlotBars slots={history.slots} liveHour={liveHour} minute={minute} best={history.best} />
              </div>
            </div>
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[24rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-faint uppercase">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Closes</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Blocks</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Per 1M bp</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">vs avg</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Usual weight</th>
                    {showBag ? (
                      <th scope="col" className="py-1.5 pl-3 text-right font-medium">Your bag</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {history.slots.map((slot) => (
                    <tr key={slot.hour} className={slot.hour === liveHour ? 'text-ink' : 'text-muted'}>
                      <td className="tabular py-1.5 pr-3">
                        {slotLabel(slot.hour, minute)}
                        {slot.hour === liveHour ? <span className="ml-1 text-xs text-accent">live</span> : null}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">{slot.blocks}</td>
                      <td className="tabular px-3 py-1.5 text-right">{formatRate(slot.rate, '')}</td>
                      <td className="tabular px-3 py-1.5 text-right">{formatIndex(slot.index)}</td>
                      <td className="tabular px-3 py-1.5 text-right" title={formatExact(slot.weight)}>
                        {formatBiopoints(slot.weight)}
                      </td>
                      {showBag ? (
                        <td className="tabular py-1.5 pl-3 text-right">
                          {formatAmount(estimateEarnings(entry.live.payout, bagWeight, slot.weight), entry.currency)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Every settled block</h3>
            <p className="mt-0.5 text-xs text-muted">
              Newest first. A block with unweighed crops shows a floor, not a rate, and stays out of
              the averages.
            </p>
            <div className="mt-2 max-h-[40vh] overflow-auto scroll-thin">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-xs tracking-wide text-faint uppercase">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Closed</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Weight</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Per 1M bp</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">vs avg</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Contributors</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Paid</th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-medium">Vault</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {history.blocks.map((block: MarketBlock) => {
                    const rate = rateOfBlock(block)
                    return (
                      <tr key={block.key} className={rate > 0 ? 'text-ink' : 'text-faint'}>
                        <td className="tabular py-1.5 pr-3">{dateTimeFormat.format(new Date(block.closeAt))}</td>
                        <td className="tabular px-3 py-1.5 text-right" title={formatExact(block.totalWeight)}>
                          {formatBiopoints(block.totalWeight)}
                          {block.unknown.length > 0 ? '*' : ''}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right">
                          {rate > 0 ? formatRate(rate, '') : `incomplete (${block.unknown.length} unknown)`}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right">
                          {rate > 0 && history.mean > 0 ? formatIndex(rate / history.mean) : '—'}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right">{block.contributors}</td>
                        <td className="tabular px-3 py-1.5 text-right">{block.payees}</td>
                        <td className="py-1.5 pl-3 text-right">
                          <a
                            href={explorerApi.addressPage(block.vault)}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex text-faint hover:text-accent"
                            aria-label="Vault on the explorer"
                            title={block.vault}
                          >
                            <ExternalLink size={14} aria-hidden="true" />
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

/**
 * Where to send the harvest, and when, from what every block actually paid.
 *
 * The window is read from the chain and cached; nothing here touches the game. The live
 * blocks from the capture supply the tier, the schedule and the payout, which is all the
 * explorer needs to be asked the right questions. The section always says what it is doing:
 * reading, idle since when, next read at what time, or why it cannot start.
 */
export function MarketRate() {
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
  const unknown = useMemo(() => named.filter((c) => !tokenFor(c)).map((c) => c || '(blank)'), [named])

  const [blocks, setBlocks] = useState<Record<string, MarketBlock[]>>({})
  const [progress, setProgress] = useState<Record<string, SyncProgress>>({})
  const [phase, setPhase] = useState<'idle' | 'reading' | 'done' | 'failed'>('idle')
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [nextRun, setNextRun] = useState<number | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [manual, setManual] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  // The countdown to the close is the one number on this page that moves on its own.
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
      // What is already known shows immediately; the explorer only fills the gaps.
      const cached = await Promise.all(currencies.map((currency) => loadBlocks(currency)))
      if (controller.signal.aborted) return
      setBlocks(Object.fromEntries(currencies.map((currency, i) => [currency, cached[i] ?? []])))

      const results = await Promise.allSettled(
        currencies.map((currency) =>
          syncCurrency(
            {
              pools,
              weightOf,
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

  const histories = useMemo(
    () =>
      Object.fromEntries(
        currencies.map((currency) => [currency, buildMarketHistory(currency, blocks[currency] ?? [])]),
      ) as Record<string, MarketHistory>,
    [currencies, blocks],
  )
  const ranked = useMemo(() => assessPools(pools, histories, bagWeight ?? 0), [pools, histories, bagWeight])

  const totalMissing = Object.values(progress).reduce((sum, p) => sum + p.total, 0)
  const totalDone = Object.values(progress).reduce((sum, p) => sum + p.done, 0)
  const skipped = Object.values(progress).reduce((sum, p) => sum + p.skipped, 0)
  const detailEntry = detail ? (ranked.find((entry) => entry.currency === detail) ?? null) : null

  const statusLine =
    phase === 'reading'
      ? totalMissing > 0
        ? `Reading settled blocks from the explorer: ${totalDone} of ${totalMissing}${skipped > 0 ? ` (${skipped} skipped)` : ''}. The first fill takes a while; you can leave this tab.`
        : 'Checking the explorer for new blocks…'
      : phase === 'failed'
        ? 'The explorer did not answer for some blocks. What was read is shown; the rest is retried on the next pass.'
        : lastRun !== null
          ? `Up to date as of ${timeFormat.format(new Date(lastRun))}${nextRun !== null ? ` · next read at ${timeFormat.format(new Date(nextRun))}` : ''}.`
          : 'Waiting to start.'

  return (
    <section className="mt-1" aria-labelledby="market-rate-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="market-rate-title" className="text-sm font-semibold text-ink">
          Where to send the harvest
        </h3>
        <p className="text-xs text-faint">The last {HISTORY_BLOCKS} blocks of your tier, read off the chain.</p>
      </div>

      {pools.blocks.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Needs a live block to know your tier and the schedule. Open the Reward Pool window in
          chainers.io, then sync again.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" role="status" aria-live="polite">
          <p className={`tabular text-xs ${phase === 'failed' ? 'text-[color:var(--danger)]' : 'text-muted'}`}>
            {statusLine}
          </p>
          <button
            type="button"
            onClick={() => setManual((n) => n + 1)}
            disabled={phase === 'reading'}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-line bg-surface-2 px-2 text-xs font-medium text-ink transition-colors duration-150 hover:bg-surface-3"
          >
            <RefreshCw size={12} aria-hidden="true" className={phase === 'reading' ? 'animate-spin' : ''} />
            {phase === 'reading' ? 'Reading…' : 'Read now'}
          </button>
        </div>
      )}

      {phase === 'reading' && totalMissing > 0 ? (
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-surface-3">
          <span
            className="block h-full bg-accent transition-[width] duration-300"
            style={{ width: `${(totalDone / totalMissing) * 100}%` }}
          />
        </span>
      ) : null}

      {unknown.length > 0 ? (
        <p role="alert" className="mt-2 text-xs text-[color:var(--warning)]">
          The capture names a currency this build cannot map to a token: {unknown.join(', ')}. Its
          history is not read. Report it with the currency name and it is a one-line fix.
        </p>
      ) : null}

      {ranked.length > 0 ? (
        <>
          <Recommendation pools={pools} ranked={ranked} bagWeight={bagWeight} now={now} />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ranked.map((entry) => (
              <button
                key={entry.currency}
                type="button"
                onClick={() => setDetail(entry.currency)}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors duration-150 hover:bg-surface-3"
              >
                <TableProperties size={13} aria-hidden="true" className="text-muted" />
                {entry.currency} history
                <span className="tabular text-faint">
                  {entry.history.complete}/{HISTORY_BLOCKS}
                </span>
              </button>
            ))}
          </div>

          <WeightTable ranked={ranked} now={now} rows={12} />
        </>
      ) : null}

      {bag.unknown.length > 0 ? (
        <p className="mt-2 text-xs text-faint">
          Not weighed in your bag (no catalogue entry): {bag.unknown.join(', ')}. Sync with the farm
          open once to capture the catalogue.
        </p>
      ) : null}

      <p className="mt-2 text-xs text-faint">
        A block pays a fixed amount split by contributed weight, so a biopoint earns most in the
        blocks few people send to. Hours are local. Nothing here touches your game.
      </p>

      <HistoryModal entry={detailEntry} bagWeight={bagWeight} onClose={() => setDetail(null)} />
    </section>
  )
}
