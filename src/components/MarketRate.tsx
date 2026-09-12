import { useState } from 'react'
import {
  ChevronRight,
  Clock,
  ExternalLink,
  RefreshCw,
  Send,
  TableProperties,
  Trophy,
} from 'lucide-react'
import {
  HISTORY_BLOCKS,
  SEND_WINDOW_MS,
  displayCurrency,
  estimateEarnings,
  explorerApi,
  rateOfBlock,
  tokenFor,
  unknownShare,
  type MarketBlock,
  type PoolAssessment,
  type SlotStat,
} from '../lib/chain'
import type { MarketState } from '../lib/useMarketHistory'
import { formatBiopoints, formatDuration, formatExact, formatPercent } from '../lib/format'
import { PRICE_SOURCE, formatUsd, usdOf } from '../lib/prices'
import type { PoolBlock, Pools } from '../lib/types'
import { Modal } from './ui'

const rateFormat = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 })
const wholeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** Whole coins get two decimals; fractions of a coin keep four significant digits. */
function formatCoin(value: number): string {
  return value >= 1 ? wholeFormat.format(value) : rateFormat.format(value)
}
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** A payout in the currency's own units, from the game's raw integers. */
export function formatAmount(raw: number, currency: string): string {
  const value = raw / 10 ** (tokenFor(currency)?.decimals ?? 9)
  const name = displayCurrency(currency)
  if (value === 0) return `0 ${name}`
  // 5.36 CFB, but 0.00001446 BNB: a share of BNB is real money at the fifth decimal.
  return `${formatCoin(value)} ${name}`
}

/** "1.86 CFB ($0.04)": the coin amount and, when a price is known, what it is worth. */
function withUsd(raw: number, currency: string, market: MarketState): string {
  const usd = usdOf(raw, currency, market.prices, market.manualPrices)
  return usd === null ? formatAmount(raw, currency) : `${formatAmount(raw, currency)} (${formatUsd(usd)})`
}

/** "7.46 CFB per 1M bp": the scale at which a rate stops being dust. */
function formatRate(rate: number, currency: string): string {
  const decimals = tokenFor(currency)?.decimals ?? 9
  return `${rateFormat.format((rate / 10 ** decimals) * 1_000_000)} ${currency ? displayCurrency(currency) : ''}`.trim()
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

/** "muddy_boots" → "Muddy Boots"; a name the game sent wins. */
function tierName(name: string | null, code: string, level: number): string {
  if (name) return name
  const pretty = code
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
  return /^(tier|level)\s*\d*$/i.test(pretty) || pretty === '' ? `Tier ${level + 1}` : pretty
}

/** A bag worth estimating: weighed, and not empty. */
function hasBag(bagWeight: number | null): bagWeight is number {
  return bagWeight !== null && bagWeight > 0
}

/* ----------------------------------------------------------------------------------------- */

function statusText(market: MarketState): string {
  const { phase, progressDone, progressTotal, skipped, lastRun, nextRun, snapshotBlocks } = market
  if (phase === 'reading') {
    const skippedNote = skipped > 0 ? ` · ${skipped} skipped` : ''
    if (progressTotal > 0) return `Reading history ${progressDone}/${progressTotal}${skippedNote}`
    return 'Checking for new blocks'
  }
  if (phase === 'failed') return 'Explorer did not answer for some blocks'
  if (lastRun === null) return 'Waiting for a live block'
  const nextNote = nextRun ? ` · next ${timeFormat.format(new Date(nextRun))}` : ''
  const sharedNote = snapshotBlocks > 0 ? ` · ${snapshotBlocks} shared blocks` : ''
  return `Updated ${timeFormat.format(new Date(lastRun))}${nextNote}${sharedNote}`
}

/**
 * One quiet line: is the history current, and when does it move next.
 *
 * The reading itself is background work; it gets a dot and a count, not a banner.
 */
export function StatusPill({ market }: { market: MarketState }) {
  const { phase, refresh } = market
  const reading = phase === 'reading'
  let tone = 'bg-accent'
  if (phase === 'failed') tone = 'bg-[color:var(--danger)]'
  else if (reading) tone = 'bg-[color:var(--warning)]'
  const text = statusText(market)

  return (
    <span className="flex items-center gap-2 text-xs text-muted" role="status" aria-live="polite">
      <span aria-hidden="true" className={`size-2 rounded-full ${tone} ${reading ? 'animate-pulse' : ''}`} />
      <span className="tabular">{text}</span>
      {market.prices ? (
        <span className="tabular text-faint" title={`BNB and MATIC prices from ${market.prices.source}; CFB has no public market.`}>
          · prices {timeFormat.format(new Date(market.prices.at))}
        </span>
      ) : null}
      <button
        type="button"
        onClick={refresh}
        disabled={reading}
        aria-label="Read the explorer now"
        title="Read the explorer now"
        className="inline-flex size-7 items-center justify-center rounded-md text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <RefreshCw size={13} aria-hidden="true" className={reading ? 'animate-spin' : ''} />
      </button>
    </span>
  )
}

/* ----------------------------------------------------------------------------------------- */

/**
 * The tier you are in and the ladder above it.
 *
 * Tiers are lifetime biopoints; the game's ladder carries the thresholds and its own icons.
 * The current rung is marked, the next one says how far, the rest say what they take.
 */
export function TierLadder({ pools }: { pools: Pools }) {
  const level = pools.level
  const ladder = [...pools.levels].sort((a, b) => a.level - b.level)
  if (!level && ladder.length === 0) return null

  const current = level?.level ?? -1
  const next = ladder.find((tier) => tier.level === current + 1) ?? null
  const toGo = next && level ? Math.max(0, next.pointsToClaim - level.points) : 0
  const previous = ladder.find((tier) => tier.level === current)?.pointsToClaim ?? 0
  const span = next ? Math.max(1, next.pointsToClaim - previous) : 1
  const progress = next && level ? Math.min(1, Math.max(0, (level.points - previous) / span)) : 1

  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <div className="flex items-center gap-3">
        {level?.icon ? (
          <img src={level.icon} alt="" width={44} height={44} className="size-11 shrink-0" />
        ) : (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-[color:var(--warning)]">
            <Trophy size={20} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-faint uppercase">Your tier</p>
          <p className="truncate text-base font-semibold text-ink">
            {level ? tierName(level.name, level.code, level.level) : 'Unknown'}
            {level ? <span className="ml-1.5 text-xs font-medium text-muted">Tier {level.level + 1}</span> : null}
          </p>
          {level ? (
            <p className="tabular text-xs text-muted" title={formatExact(level.points)}>
              {formatBiopoints(level.points)} lifetime bp
              {next ? (
                <>
                  {' '}
                  · <span className="text-ink">{formatBiopoints(toGo)}</span> to {tierName(next.name, next.code, next.level)}
                </>
              ) : (
                ' · top tier'
              )}
            </p>
          ) : null}
        </div>
      </div>

      {next ? (
        <span aria-hidden="true" className="mt-2.5 block h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <span className="block h-full bg-accent" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
        </span>
      ) : null}

      {ladder.length > 0 ? (
        <ol className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${ladder.length}, minmax(0, 1fr))` }}>
          {ladder.map((tier) => {
            const reached = tier.level <= current
            const isCurrent = tier.level === current
            let nameTone = 'text-faint'
            if (isCurrent) nameTone = 'font-semibold text-ink'
            else if (reached) nameTone = 'text-muted'
            return (
              <li
                key={tier.code}
                className={`flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center ${
                  isCurrent ? 'bg-accent-dim' : ''
                }`}
                title={`${tierName(tier.name, tier.code, tier.level)}: ${formatExact(tier.pointsToClaim)} lifetime biopoints`}
              >
                {tier.icon ? (
                  <img
                    src={tier.icon}
                    alt=""
                    width={28}
                    height={28}
                    className="size-7"
                    style={reached ? undefined : { filter: 'grayscale(1)', opacity: 0.5 }}
                  />
                ) : (
                  <span className={`text-xs font-semibold ${reached ? 'text-ink' : 'text-faint'}`}>T{tier.level + 1}</span>
                )}
                <span className={`truncate text-xs ${nameTone}`}>
                  {tierName(tier.name, tier.code, tier.level)}
                </span>
                <span className="tabular text-xs text-faint">{formatBiopoints(tier.pointsToClaim)}</span>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}

/* ----------------------------------------------------------------------------------------- */

/** What is in the bag, in biopoints: the thing every estimate on this page is about. */
export function BagCard({ market }: { market: MarketState }) {
  const { bagWeight, bagUnknown, ranked, manualPrices, setManualPrice } = market
  const best = ranked.find((entry) => entry.ready && entry.earnUsd !== null) ?? null
  const unpriced = [...new Set(ranked.filter((entry) => market.priceOf(entry.currency) === null).map((entry) => displayCurrency(entry.currency)))]
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <p className="text-xs font-semibold tracking-wide text-faint uppercase">Your bag</p>
      {bagWeight === null ? (
        <p className="mt-1 text-sm text-muted">Sync your inventory to weigh the produce you hold.</p>
      ) : (
        <>
          <p className="mt-1 flex items-baseline gap-1.5" title={formatExact(bagWeight)}>
            <span className="tabular text-2xl leading-none font-semibold text-accent">{formatBiopoints(bagWeight)}</span>
            <span className="text-xs text-muted">bp of produce ready to send</span>
          </p>
          {best && best.earnUsd !== null && bagWeight > 0 ? (
            <p className="tabular mt-1 text-xs text-muted">
              Worth about <span className="font-semibold text-ink">{formatUsd(best.earnUsd)}</span> in the{' '}
              {displayCurrency(best.currency)} pool right now, at {PRICE_SOURCE.name} prices.
            </p>
          ) : null}
          <p className="mt-1.5 text-xs text-faint">
            {bagUnknown.length > 0
              ? `Not weighed (no catalogue entry): ${bagUnknown.join(', ')}. Sync with the farm open to capture it.`
              : 'Every item weighed with the game’s own catalogue.'}
          </p>
        </>
      )}
      {unpriced.includes('CFB') ? (
        <label className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="min-w-0 flex-1">
            CFB has no public market. Reference price, USD per CFB (optional, stays on this device):
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={manualPrices.CFB ?? ''}
            onChange={(event) => setManualPrice('CFB', event.target.value === '' ? null : Number(event.target.value))}
            placeholder="0.00"
            className="tabular min-h-8 w-24 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
          />
        </label>
      ) : null}
    </div>
  )
}

/* ----------------------------------------------------------------------------------------- */

/**
 * A horizontal meter of one pool's live block against its own window: the lightest and
 * heaviest closes of the last blocks are the ends, the usual close for this hour is a tick,
 * the live weight is the fill and the expected close a hollow marker.
 */
function PoolGauge({ entry }: { entry: PoolAssessment }) {
  const { low, high, liveWeight, projected, slot } = entry
  // From empty to a little past the heaviest close, so every pool's fill means the same thing.
  const top = Math.max(1, high * 1.05, liveWeight)
  const pct = (value: number) => `${Math.min(100, Math.max(0, (value / top) * 100)).toFixed(1)}%`
  const tick = (value: number, label: string, className: string) => (
    <span
      aria-hidden="true"
      className={`absolute top-1/2 h-4 w-0.5 -translate-y-1/2 ${className}`}
      style={{ left: pct(value) }}
      title={`${label}: ${formatExact(value)}`}
    />
  )
  return (
    <div className="mt-2.5">
      <div
        className="relative h-2.5 w-full overflow-visible rounded-full bg-surface-3"
        role="img"
        aria-label={`In the block now ${formatExact(liveWeight)}, expected ${formatExact(projected)}, lightest close ${formatExact(low)}, heaviest ${formatExact(high)}`}
      >
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pct(liveWeight) }} />
        {tick(low, 'lightest close in the window', 'bg-[color:var(--text-faint)]')}
        {slot ? tick(slot.weight, 'usual close for this hour', 'bg-[color:var(--text-muted)]') : null}
        {tick(high, 'heaviest close in the window', 'bg-[color:var(--text-faint)]')}
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--accent)] bg-surface"
          style={{ left: pct(projected) }}
          title={`expected close: ${formatExact(projected)}`}
        />
      </div>
      <div className="tabular mt-1 flex flex-wrap justify-between gap-x-2 text-xs text-faint">
        <span>0</span>
        <span title={formatExact(low)}>low {formatBiopoints(low)}</span>
        {slot ? <span title={formatExact(slot.weight)}>usual {formatBiopoints(slot.weight)}</span> : null}
        <span title={formatExact(high)}>high {formatBiopoints(high)}</span>
      </div>
      <p className="mt-0.5 text-xs text-faint">Bar is what the block holds now; hollow dot is where it is expected to end.</p>
    </div>
  )
}

function verdictOf(entry: PoolAssessment): { label: string; className: string } {
  if (!entry.ready) return { label: 'Reading history', className: 'border-line bg-surface text-muted' }
  if (entry.position <= 0.25) return { label: 'Light block', className: 'border-[color:var(--accent)] bg-accent-dim text-accent' }
  if (entry.position >= 0.75) return { label: 'Heavy block', className: 'border-[color:var(--warning)]/60 bg-[color:var(--warning)]/10 text-[color:var(--warning)]' }
  return { label: 'Average block', className: 'border-line bg-surface text-ink' }
}

/**
 * The three pools right now: what is in the block, where that sits against its history,
 * your share of it today, and what the whole bag would earn if it went in.
 */
export function PoolsNow({ pools, market }: { pools: Pools; market: MarketState }) {
  const { ranked } = market
  if (ranked.length === 0) return null

  const groupOf = (block: PoolBlock) => pools.groups.find((group) => group.groupCode === block.groupCode)

  return (
    <ul className="grid gap-2 md:grid-cols-3">
      {[...ranked]
        .sort((a, b) => a.currency.localeCompare(b.currency))
        .map((entry) => renderPoolCard(entry, groupOf(entry.live), market))}
    </ul>
  )
}

/** How fresh the live weight is, and where it came from. */
function poolSourceNote(entry: PoolAssessment, market: MarketState): string {
  const { weightSource, currency } = entry
  if (weightSource === 'chain') {
    const readAgo = entry.readAt !== null ? Math.max(0, Math.round((market.now - entry.readAt) / 60_000)) : null
    const ago = readAgo === 0 ? 'just now' : `${readAgo} min ago`
    return `Read off the chain ${ago}; refreshes every 5 minutes.`
  }
  if (market.readingOpen) return 'Reading the open block off the chain…'
  if (market.liveFailed.includes(currency)) {
    return 'The explorer would not serve this block, so the weight is your capture, which is as old as your last sync.'
  }
  return weightSource === 'capture' ? 'From your capture, which is as old as your last sync.' : ''
}

function renderPoolWeight(entry: PoolAssessment) {
  const { weightSource, liveWeight } = entry
  return weightSource === 'none' ? (
    <p className="mt-2.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-muted">
      Reading the open block off the chain…
      {entry.ready ? ` Blocks closing at this hour usually end near ${formatBiopoints(entry.projected)}.` : ''}
    </p>
  ) : (
    <p className="tabular mt-2.5 flex flex-wrap items-baseline gap-1.5" title={formatExact(liveWeight)}>
      <span className="text-xl leading-none font-semibold text-ink">{formatBiopoints(liveWeight)}</span>
      <span className="text-xs text-muted">bp in the block now</span>
      {entry.ready && entry.slot ? (
        <span className="text-xs text-faint">
          · usually ends near {formatBiopoints(entry.slot.weight)} ({entry.slot.blocks} sample{entry.slot.blocks === 1 ? '' : 's'})
        </span>
      ) : null}
    </p>
  )
}

function renderPoolGauge(entry: PoolAssessment) {
  if (entry.ready && entry.weightSource !== 'none') return <PoolGauge entry={entry} />
  return entry.ready ? null : (
    <p className="mt-2 text-xs text-faint">
      {entry.history.complete} of the last {HISTORY_BLOCKS} blocks read so far; six (a day) are
      needed before this one can be placed against them.
    </p>
  )
}

function renderBagRows(entry: PoolAssessment, market: MarketState) {
  const { bagWeight } = market
  if (!(hasBag(bagWeight) && entry.ready)) return null
  const { live, currency, weightSource } = entry
  const atLow = estimateEarnings(live.payout, bagWeight, entry.low)
  return (
    <>
      {weightSource !== 'none' ? (
        <div className="flex justify-between gap-2 py-1">
          <dt className="text-faint" title="What the game shows: your share if the block closed with what it holds this second.">
            Bag, if it closed now
          </dt>
          <dd className="tabular m-0 text-ink">≈ {withUsd(entry.earnNow, currency, market)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between gap-2 py-1">
        <dt className="text-faint" title="The block keeps filling until it closes; this assumes it ends where blocks closing at this hour usually end.">
          Bag, expected at close
        </dt>
        <dd className="tabular m-0 font-semibold text-accent">≈ {withUsd(entry.earn, currency, market)}</dd>
      </div>
      <div className="flex justify-between gap-2 py-1">
        <dt className="text-faint">Bag, at the window low</dt>
        <dd className="tabular m-0 text-muted">≈ {withUsd(atLow, currency, market)}</dd>
      </div>
    </>
  )
}

function renderVaultLink(entry: PoolAssessment) {
  const { live, stale } = entry
  return entry.vault || (live.explorerURL && !stale) ? (
    <a
      href={entry.vault ? explorerApi.addressPage(entry.vault) : live.explorerURL}
      target="_blank"
      rel="noreferrer noopener"
      className="ml-1.5 inline-flex align-middle text-faint hover:text-accent"
      aria-label="Block vault on the explorer"
      title="Block vault on the explorer"
    >
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  ) : null
}

function renderPoolCard(entry: PoolAssessment, group: Pools['groups'][number] | undefined, market: MarketState) {
  const { live, currency, stale } = entry
  const left = closesIn(entry.closesAt, market.now)
  const share = live.totalWeight > 0 ? live.userWeight / live.totalWeight : 0
  const verdict = verdictOf(entry)
  return (
    <li key={currency} className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <div className="flex items-center gap-2">
        {group?.icon ? <img src={group.icon} alt="" width={24} height={24} className="size-6 shrink-0" /> : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{group?.title ?? `${displayCurrency(currency)} pool`}</p>
          <p className="tabular text-xs text-faint">{withUsd(live.payout, currency, market)} per block</p>
        </div>
        <span className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${verdict.className}`}>
          {verdict.label}
        </span>
      </div>

      {renderPoolWeight(entry)}
      <p className="mt-1 text-xs text-faint">
        {poolSourceNote(entry, market)}
      </p>

      {renderPoolGauge(entry)}

      <dl className="mt-2.5 divide-y divide-[color:var(--border)] text-xs">
        <div className="flex justify-between gap-2 py-1">
          <dt className="text-faint" title={stale ? 'Your share comes from the capture, and the capture is from a block that already closed.' : undefined}>
            Your share{stale ? ' (last capture)' : ' now'}
          </dt>
          <dd className={`tabular m-0 ${stale ? 'text-faint' : 'text-ink'}`}>
            {stale ? 'sync to update' : `${formatPercent(share, 3)} · ${formatAmount(live.payout * share, currency)}`}
          </dd>
        </div>
        {renderBagRows(entry, market)}
        <div className="flex justify-between gap-2 py-1">
          <dt className="text-faint">Closes</dt>
          <dd className="tabular m-0 text-ink">
            {timeFormat.format(new Date(entry.closesAt))} your time
            {left > 0 ? ` · in ${formatDuration(left / 1000)}` : ''}
            {renderVaultLink(entry)}
          </dd>
        </div>
      </dl>
    </li>
  )
}

/* ----------------------------------------------------------------------------------------- */

/**
 * Where to send the bag, and when.
 *
 * The pool whose block sits lightest against its own history, what that earns, and the one
 * rule of timing: share is by weight, not by time, so waiting costs nothing and the last
 * minutes are when the block's weight is known.
 */
function renderNoRecommendation(market: MarketState) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <p className="text-sm font-semibold text-ink">No recommendation yet</p>
      <p className="mt-0.5 text-xs text-muted">
        A verdict needs six settled blocks (a day) per pool.{' '}
        {market.snapshotBlocks > 0
          ? `The shared history has ${market.snapshotBlocks}; the rest is read from the chain, about a minute a block.`
          : 'This site serves no shared history, so every block is read from the chain: about a minute each.'}
      </p>
    </div>
  )
}

/** Where the recommended block is headed: the usual close for its hour, or above it. */
function renderExpectedClose(top: PoolAssessment) {
  if (top.slot && top.liveWeight <= top.slot.weight) {
    return <>is on track for the usual <span className="text-ink">{formatBiopoints(top.slot.weight)}</span> of blocks closing at this hour ({top.slot.blocks} sample{top.slot.blocks === 1 ? '' : 's'})</>
  }
  let usual = ''
  if (top.slot) {
    const plural = top.slot.blocks === 1 ? '' : 's'
    usual = ` (${formatIndex(top.crowd)} above the usual ${formatBiopoints(top.slot.weight)} for this hour, ${top.slot.blocks} sample${plural})`
  }
  return <>is expected to close near <span className="text-ink">{formatBiopoints(top.projected)}</span>{usual}</>
}

function closeNowText(top: PoolAssessment, market: MarketState): string {
  return top.weightSource !== 'none' && hasBag(market.bagWeight)
    ? ` If it closed this second the bag would earn ≈ ${withUsd(top.earnNow, top.currency, market)}, which is the number the game shows; the block keeps filling until the close.`
    : ''
}

function timingText(top: PoolAssessment, left: number, sendNow: boolean): string {
  const closeLabel = timeFormat.format(new Date(top.closesAt))
  return sendNow
    ? `Send now: closes at ${closeLabel} your time, in ${formatDuration(left / 1000)}.`
    : `Closes at ${closeLabel} your time, in ${formatDuration(left / 1000)}. Send in the last ${SEND_WINDOW_MS / 60_000} minutes: share is by weight, not by time, so waiting costs nothing, and the less time left the more you know about how heavy the block will end.`
}

function renderOtherPools(top: PoolAssessment, market: MarketState) {
  const { ranked, bagWeight } = market
  if (ranked.length <= 1) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line/60 pt-2 text-xs text-muted">
      {ranked
        .filter((entry) => entry !== top)
        .map((entry) => (
          <li key={entry.currency} className="tabular">
            <span className="font-medium text-ink">{displayCurrency(entry.currency)}</span>
            {entry.ready ? (
              <>
                {' '}
                {hasBag(bagWeight) ? `≈ ${withUsd(entry.earn, entry.currency, market)} · ` : ''}
                {Math.round(entry.position * 100)}% of its range
                {entry.earnUsd === null && hasBag(bagWeight) ? ' · no price' : ''}
              </>
            ) : (
              <span className="text-faint"> · reading history</span>
            )}
          </li>
        ))}
    </ul>
  )
}

function rankingNote(top: PoolAssessment, market: MarketState): string {
  return top.earnUsd !== null
    ? `Ranked by what the bag earns in dollars at ${market.prices?.source ?? 'reference'} prices; pools with no price come after, ranked against their own history only.`
    : 'Ranked against each pool’s own history. Add a reference price for CFB, or wait for BNB and MATIC prices, to rank in dollars.'
}

export function Recommendation({ pools, market }: { pools: Pools; market: MarketState }) {
  const { ranked, bagWeight, now } = market
  const top = ranked.find((entry) => entry.ready) ?? null
  const tier = pools.level ? tierName(pools.level.name, pools.level.code, pools.level.level) : 'your tier'

  if (!top) return renderNoRecommendation(market)

  const left = closesIn(top.closesAt, now)
  const sendNow = left > 0 && left <= SEND_WINDOW_MS
  const lowEarn = hasBag(bagWeight) ? estimateEarnings(top.live.payout, bagWeight, top.low) : 0

  return (
    <div className="rounded-xl border border-[color:var(--accent)] bg-accent-dim px-3.5 py-3">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Where to send · {tier}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold text-ink">
        <Send size={16} aria-hidden="true" className="text-accent" />
        {displayCurrency(top.currency)}
        {hasBag(bagWeight) ? (
          <span className="tabular text-accent">≈ {withUsd(top.earn, top.currency, market)} for the whole bag</span>
        ) : null}
      </p>

      <p className="tabular mt-1.5 text-xs text-muted">
        {top.weightSource === 'none'
          ? 'The block open now'
          : `Its block holds ${formatBiopoints(top.liveWeight)} now and`}{' '}
        {renderExpectedClose(top)}.
        {closeNowText(top, market)}
        The lightest of the last {top.history.complete} blocks closed at{' '}
        <span className="text-ink">{formatBiopoints(top.low)}</span>
        {lowEarn > 0 ? ` (the bag would earn ≈ ${withUsd(lowEarn, top.currency, market)} there)` : ''}, the heaviest at{' '}
        <span className="text-ink">{formatBiopoints(top.high)}</span>. This one sits at{' '}
        <span className="font-semibold text-ink">{Math.round(top.position * 100)}%</span> of that range; lower is
        better.
      </p>

      <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-ink">
        <Clock size={13} aria-hidden="true" className={`mt-0.5 shrink-0 ${sendNow ? 'text-accent' : 'text-muted'}`} />
        <span>
          {timingText(top, left, sendNow)}
          {top.stale ? ' Your capture is from an earlier block; reload the farm page in chainers.io and sync to refresh your share.' : ''}
        </span>
      </p>

      {renderOtherPools(top, market)}

      <p className="mt-2 text-xs text-faint">
        {rankingNote(top, market)}
      </p>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------- */

/**
 * What each closing hour usually looks like, in the reader's local time.
 *
 * Bars are the usual final weight per slot (lower is better for you); the live slot is in
 * the accent, the lightest slot carries its label. A sentence says which hours to aim for.
 */
export function Trends({ market }: { market: MarketState }) {
  const ready = market.ranked.filter((entry) => entry.ready && entry.history.slots.length > 0)
  if (ready.length === 0) return null

  return (
    <section aria-labelledby="pool-trends-title">
      <h3 id="pool-trends-title" className="text-sm font-semibold text-ink">
        Trends by closing hour
      </h3>
      <p className="mt-0.5 text-xs text-muted">
        How heavy each block usually is when it closes, over the last {HISTORY_BLOCKS} blocks. Hours are yours.
      </p>
      <ul className="mt-2.5 grid gap-2 md:grid-cols-3">
        {[...ready]
          .sort((a, b) => a.currency.localeCompare(b.currency))
          .map((entry) => {
            const minute = new Date(entry.live.endDate).getMinutes()
            const liveHour = new Date(entry.live.endDate).getHours()
            const slots = entry.history.slots
            const lightest = [...slots].sort((a, b) => a.weight - b.weight)[0] ?? null
            const heaviest = [...slots].sort((a, b) => b.weight - a.weight)[0] ?? null
            const max = Math.max(...slots.map((slot) => slot.weight), 1)
            return (
              <li key={entry.currency} className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
                <p className="text-sm font-semibold text-ink">{displayCurrency(entry.currency)}</p>
                <ol className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
                  {slots.map((slot: SlotStat) => {
                    const live = slot.hour === liveHour
                    const isLightest = lightest?.hour === slot.hour
                    const height = Math.max(4, Math.round((slot.weight / max) * 48))
                    return (
                      <li
                        key={slot.hour}
                        className="flex flex-col items-center gap-1"
                        title={`${slotLabel(slot.hour, minute)} · usually ${formatExact(slot.weight)} bp · ${formatRate(slot.rate, entry.currency)} per 1M bp (${formatIndex(slot.index)}) · ${slot.blocks} blocks`}
                      >
                        <span className="tabular h-4 text-xs leading-4 text-muted">
                          {isLightest ? formatBiopoints(slot.weight) : ''}
                        </span>
                        <span className="flex h-12 w-full items-end justify-center">
                          <span
                            aria-hidden="true"
                            className={`w-full max-w-5 rounded-t-[4px] ${live ? 'bg-accent' : 'bg-surface-3'}`}
                            style={{ height }}
                          />
                        </span>
                        <span className={`tabular text-xs ${live || isLightest ? 'font-semibold text-ink' : 'text-faint'}`}>
                          {slotLabel(slot.hour, minute)}
                        </span>
                      </li>
                    )
                  })}
                </ol>
                {lightest && heaviest ? (
                  <p className="tabular mt-2 text-xs text-muted">
                    Lightest at <span className="font-semibold text-ink">{slotLabel(lightest.hour, minute)}</span> (≈
                    {formatBiopoints(lightest.weight)}, {formatIndex(lightest.index)} per bp)
                    {heaviest.hour !== lightest.hour ? (
                      <>
                        , heaviest at <span className="text-ink">{slotLabel(heaviest.hour, minute)}</span> (≈
                        {formatBiopoints(heaviest.weight)})
                      </>
                    ) : null}
                    . Aim for the light closes when the bag can wait.
                  </p>
                ) : null}
              </li>
            )
          })}
      </ul>
    </section>
  )
}

/* ----------------------------------------------------------------------------------------- */

/** Every block of every pool, newest first, the window's lightest per pool in green. */
export function WeightTable({ market, rows }: { market: MarketState; rows: number }) {
  const { ranked, now } = market
  const entries = [...ranked].sort((a, b) => a.currency.localeCompare(b.currency))
  const currencies = entries.map((entry) => entry.currency)
  const byCurrency = new Map(entries.map((entry) => [entry.currency, entry]))
  const closes = [...new Set(entries.flatMap((entry) => entry.history.blocks.map((block) => block.closeAt)))]
    .sort((a, b) => Date.parse(b) - Date.parse(a))
    .slice(0, rows)
  const lows = new Map(currencies.map((currency) => [currency, byCurrency.get(currency)?.low ?? 0]))
  const liveEnd = entries[0]?.closesAt ?? ''
  const stale = entries[0]?.stale ?? false
  if (entries.length === 0) return null

  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="sr-only">Total contributed weight per block and pool</caption>
        <thead>
          <tr className="text-left text-xs tracking-wide text-faint uppercase">
            <th scope="col" className="py-1.5 pr-3 font-medium">Block closes</th>
            {currencies.map((currency) => (
              <th key={currency} scope="col" className="px-3 py-1.5 text-right font-medium">
                {displayCurrency(currency)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          <tr className="bg-accent-dim/60">
            <td className="tabular py-1.5 pr-3 text-ink">
              <span className="font-semibold">{stale ? 'Captured' : 'Now'}</span>
              <span className="text-xs text-muted">
                {' '}
                · {stale ? 'closed block, sync again' : `closes ${timeFormat.format(new Date(liveEnd))} · in ${formatDuration(closesIn(liveEnd, now) / 1000)}`}
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
                const share = unknownShare(block)
                const isLow = rated && block.totalWeight === lows.get(currency)
                let cellTone = 'text-faint'
                if (isLow) cellTone = 'font-semibold text-accent'
                else if (rated) cellTone = 'text-ink'
                let cellTitle = `not rated: ${(share * 100).toFixed(0)}% of units unweighed (${block.unknown.join(', ')})`
                if (rated) {
                  const unweighed = share > 0 ? ` · ${(share * 100).toFixed(1)}% of units unweighed: ${block.unknown.join(', ')}` : ''
                  cellTitle = `${formatExact(block.totalWeight)} · ${formatRate(rateOfBlock(block), currency)} per 1M bp${unweighed}`
                }
                return (
                  <td
                    key={currency}
                    className={`tabular px-3 py-1.5 text-right ${cellTone}`}
                    title={cellTitle}
                  >
                    {share > 0 ? '≈' : ''}
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
        Green is the window&apos;s lightest block, the best a biopoint did. Arrow is the expected close of the live
        block. ≈ means a few percent of that block could not be weighed (hover for which); * means too many, so
        it is shown but not rated.
      </p>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------- */

export function HistoryModal({
  entry,
  bagWeight,
  market,
  onClose,
}: {
  entry: PoolAssessment | null
  bagWeight: number | null
  market: MarketState
  onClose: () => void
}) {
  const history = entry?.history ?? null
  const minute = entry ? new Date(entry.live.endDate).getMinutes() : 49
  const liveHour = entry ? new Date(entry.live.endDate).getHours() : null
  const showBag = bagWeight !== null && bagWeight > 0

  return (
    <Modal open={entry !== null} onClose={onClose} title={`${entry ? displayCurrency(entry.currency) : ''} blocks, from the chain`} wide>
      {entry && history ? (
        <div className="flex flex-col gap-4">
          <div className="overflow-x-auto scroll-thin">
            <h3 className="text-sm font-semibold text-ink">By closing hour</h3>
            <table className="mt-2 w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-faint uppercase">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Closes</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Blocks</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Usual weight</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Per 1M bp</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">vs avg</th>
                  {showBag ? <th scope="col" className="py-1.5 pl-3 text-right font-medium">Your bag</th> : null}
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
                    <td className="tabular px-3 py-1.5 text-right" title={formatExact(slot.weight)}>
                      {formatBiopoints(slot.weight)}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right">{formatRate(slot.rate, '')}</td>
                    <td className="tabular px-3 py-1.5 text-right">{formatIndex(slot.index)}</td>
                    {showBag ? (
                      <td className="tabular py-1.5 pl-3 text-right">
                        {withUsd(estimateEarnings(entry.live.payout, bagWeight, slot.weight), entry.currency, market)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Every settled block</h3>
            <div className="mt-2 max-h-[40vh] overflow-auto scroll-thin">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-xs tracking-wide text-faint uppercase">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Closed</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Weight</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Per 1M bp</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">vs avg</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Contributors</th>
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
                          {unknownShare(block) > 0 ? '≈' : ''}
                          {formatBiopoints(block.totalWeight)}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right">
                          {rate > 0 ? formatRate(rate, '') : `not rated (${block.unknown.length} unknown)`}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right">
                          {rate > 0 && history.mean > 0 ? formatIndex(rate / history.mean) : '—'}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right">{block.contributors}</td>
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

/** The buttons that open the per-pool detail, and the full table behind a disclosure. */
export function HistoryDoors({ market }: { market: MarketState }) {
  const [detail, setDetail] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const entry = detail ? (market.ranked.find((candidate) => candidate.currency === detail) ?? null) : null
  if (market.ranked.length === 0) return null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors duration-150 hover:bg-surface-3"
        >
          <ChevronRight size={13} aria-hidden="true" className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
          Every block, all pools
        </button>
        {[...market.ranked]
          .sort((a, b) => a.currency.localeCompare(b.currency))
          .map((candidate) => (
            <button
              key={candidate.currency}
              type="button"
              onClick={() => setDetail(candidate.currency)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-xs font-medium text-ink transition-colors duration-150 hover:bg-surface-3"
            >
              <TableProperties size={13} aria-hidden="true" className="text-muted" />
              {displayCurrency(candidate.currency)} detail
              <span className="tabular text-faint">
                {candidate.history.complete}/{HISTORY_BLOCKS}
              </span>
            </button>
          ))}
      </div>
      {open ? (
        <div className="mt-2.5">
          <WeightTable market={market} rows={HISTORY_BLOCKS} />
        </div>
      ) : null}
      <HistoryModal entry={entry} bagWeight={market.bagWeight} market={market} onClose={() => setDetail(null)} />
    </div>
  )
}
