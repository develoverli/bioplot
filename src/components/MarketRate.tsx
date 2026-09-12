import { useEffect, useMemo, useState } from 'react'
import { CircleCheck, Clock, ExternalLink, Minus, TableProperties } from 'lucide-react'
import {
  CURRENCY_TOKENS,
  HISTORY_BLOCKS,
  SETTLE_GRACE_MS,
  buildMarketHistory,
  buildWeightLookup,
  explorerApi,
  judgeLiveBlock,
  perMillion,
  rateOfBlock,
  type LiveJudgement,
  type MarketBlock,
  type MarketHistory,
  type SlotStat,
  type Verdict,
} from '../lib/chain'
import { loadBlocks } from '../lib/chainDb'
import { nextSyncAt, syncCurrency, type SyncProgress } from '../lib/chainSync'
import { formatBiopoints, formatExact } from '../lib/format'
import type { PoolBlock, Pools } from '../lib/types'
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

/** "7.46 CFB per 1M bp": the scale at which a rate stops being dust. */
function formatRate(rate: number, currency: string): string {
  return `${rateFormat.format(perMillion(rate, currency))} ${currency}`
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

const VERDICT_META: Record<Verdict, { label: string; Icon: typeof Clock; className: string }> = {
  good: { label: 'Good block', Icon: CircleCheck, className: 'border-[color:var(--accent)] bg-accent-dim text-accent' },
  average: { label: 'Average block', Icon: Minus, className: 'border-line bg-surface-2 text-ink' },
  wait: { label: 'Hold', Icon: Clock, className: 'border-[color:var(--warning)]/60 bg-[color:var(--warning)]/10 text-[color:var(--warning)]' },
}

function whyLine(judgement: LiveJudgement, minute: number): string {
  const { slot, crowd, better, verdict } = judgement
  if (!slot) return 'No settled blocks for this closing hour yet.'
  const parts = [`This hour usually pays ${formatIndex(slot.index)} vs average.`]
  if (crowd !== null && crowd >= 1.15) {
    parts.push(`Already ${Math.round((crowd - 1) * 100)}% fuller than it normally ends.`)
  }
  if (verdict === 'wait' && better) {
    parts.push(`${slotLabel(better.hour, minute)} pays ${formatIndex(better.index)}.`)
  }
  return parts.join(' ')
}

/**
 * Six bars, one per closing hour, the live one in the accent.
 *
 * Height is the slot's rate against the best slot, so the shape reads at a glance; the exact
 * numbers live in the table behind "Details". Only the best slot carries a value label.
 */
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
    <ol className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
      {slots.map((slot) => {
        const live = slot.hour === liveHour
        const isBest = best?.hour === slot.hour
        const height = Math.max(4, Math.round((slot.rate / max) * 56))
        return (
          <li
            key={slot.hour}
            className="flex flex-col items-center gap-1"
            title={`${slotLabel(slot.hour, minute)} · ${formatRate(slot.rate, '')}per 1M bp · ${formatIndex(slot.index)} · ${slot.blocks} blocks`}
          >
            <span className="tabular h-4 text-xs leading-4 text-muted">
              {isBest ? formatIndex(slot.index) : ''}
            </span>
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

function CurrencyCard({
  pools,
  live,
  history,
  progress,
  onDetails,
}: {
  pools: Pools
  live: PoolBlock
  history: MarketHistory
  progress: SyncProgress | null
  onDetails: () => void
}) {
  const group = pools.groups.find((candidate) => candidate.groupCode === live.groupCode)
  const minute = new Date(live.endDate).getMinutes()
  const liveHour = new Date(live.endDate).getHours()
  const judgement = judgeLiveBlock(live, history)
  const meta = VERDICT_META[judgement.verdict]
  const enough = history.complete >= 6
  const payoutLabel = `${rateFormat.format(live.payout / 10 ** (CURRENCY_TOKENS[live.currency]?.decimals ?? 9))} ${live.currency}`

  return (
    <li className="flex min-w-0 flex-col rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {group?.icon ? <img src={group.icon} alt="" width={22} height={22} className="size-5.5" /> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{group?.title ?? live.currency}</span>
          <span className="tabular block text-xs text-faint">
            {payoutLabel} per block · tier {pools.level ? pools.level.level + 1 : '—'}
          </span>
        </span>
        <button
          type="button"
          onClick={onDetails}
          className="inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
          aria-label={`${live.currency} block history`}
          title="Block history"
        >
          <TableProperties size={15} aria-hidden="true" />
        </button>
      </div>

      {enough ? (
        <>
          <p className={`mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-lg border px-2 py-1 text-sm font-semibold ${meta.className}`}>
            <meta.Icon size={14} aria-hidden="true" />
            {judgement.verdict === 'wait' && judgement.better
              ? `Hold for ${slotLabel(judgement.better.hour, minute)}`
              : meta.label}
          </p>
          <p className="mt-1.5 text-xs text-muted">{whyLine(judgement, minute)}</p>
        </>
      ) : (
        <p className="mt-2.5 text-xs text-muted">
          {progress && progress.total > 0
            ? `Reading block ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : `${history.complete} of ${HISTORY_BLOCKS} blocks read. A verdict needs a day's worth.`}
        </p>
      )}

      <SlotBars slots={history.slots} liveHour={liveHour} minute={minute} best={history.best} />

      {history.best ? (
        <p className="tabular mt-2 text-xs text-faint">
          Best {slotLabel(history.best.hour, minute)} · avg {formatRate(history.mean, live.currency)} per 1M bp ·{' '}
          {history.complete} blocks
        </p>
      ) : null}
    </li>
  )
}

function HistoryModal({
  currency,
  history,
  minute,
  onClose,
}: {
  currency: string | null
  history: MarketHistory | null
  minute: number
  onClose: () => void
}) {
  return (
    <Modal open={currency !== null} onClose={onClose} title={`${currency ?? ''} blocks, from the chain`} wide>
      {history ? (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">By closing hour</h3>
            <p className="mt-0.5 text-xs text-muted">
              Average of the complete blocks in each slot. Index is the slot against the window mean.
            </p>
            <div className="mt-2 overflow-x-auto scroll-thin">
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-faint uppercase">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Closes</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Blocks</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Per 1M bp</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">vs avg</th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-medium">Usual weight</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {history.slots.map((slot) => (
                    <tr key={slot.hour} className={history.best?.hour === slot.hour ? 'text-ink' : 'text-muted'}>
                      <td className="tabular py-1.5 pr-3">{slotLabel(slot.hour, minute)}</td>
                      <td className="tabular px-3 py-1.5 text-right">{slot.blocks}</td>
                      <td className="tabular px-3 py-1.5 text-right">{formatRate(slot.rate, '')}</td>
                      <td className="tabular px-3 py-1.5 text-right">{formatIndex(slot.index)}</td>
                      <td className="tabular py-1.5 pl-3 text-right" title={formatExact(slot.weight)}>
                        {formatBiopoints(slot.weight)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink">Every settled block</h3>
            <p className="mt-0.5 text-xs text-muted">
              Newest first. A block with unweighed crops shows a floor, not a rate, and stays out of the averages.
            </p>
            <div className="mt-2 max-h-[40vh] overflow-auto scroll-thin">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-left text-xs tracking-wide text-faint uppercase">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Closed</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Per 1M bp</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">vs avg</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Weight</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Contributors</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Paid</th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-medium">Vault</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {history.blocks.map((block) => {
                    const rate = rateOfBlock(block)
                    return (
                      <tr key={block.key} className={rate > 0 ? 'text-ink' : 'text-faint'}>
                        <td className="tabular py-1.5 pr-3">{dateTimeFormat.format(new Date(block.closeAt))}</td>
                        <td className="tabular px-3 py-1.5 text-right">
                          {rate > 0 ? formatRate(rate, '') : `incomplete (${block.unknown.length} unknown)`}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right">
                          {rate > 0 && history.mean > 0 ? formatIndex(rate / history.mean) : '—'}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right" title={formatExact(block.totalWeight)}>
                          {formatBiopoints(block.totalWeight)}
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
 * When to send the harvest, from what every block actually paid.
 *
 * The window is read from the chain and cached; nothing here touches the game. The live
 * blocks from the capture supply the tier, the schedule and the payout, which is all the
 * explorer needs to be asked the right questions.
 */
export function MarketRate() {
  const pools = useStore((state) => state.inventory.pools)
  const catalogue = useStore((state) => state.catalogue)
  const weightOf = useMemo(() => buildWeightLookup(catalogue), [catalogue])

  const currencies = useMemo(
    () => [...new Set(pools.blocks.map((block) => block.currency))].filter((c) => CURRENCY_TOKENS[c]),
    [pools.blocks],
  )

  const [blocks, setBlocks] = useState<Record<string, MarketBlock[]>>({})
  const [progress, setProgress] = useState<Record<string, SyncProgress>>({})
  const [syncing, setSyncing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    if (currencies.length === 0) return
    const controller = new AbortController()
    let timer: number | undefined

    const run = async () => {
      setSyncing(true)
      setFailed(false)
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
      setFailed(results.some((result) => result.status === 'rejected'))
      setSyncing(false)
      setProgress({})

      const next = nextSyncAt(pools, SETTLE_GRACE_MS)
      if (next !== null) {
        timer = window.setTimeout(() => void run(), Math.max(10_000, next - Date.now()))
      }
    }

    void run()
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [currencies, pools, weightOf])

  if (currencies.length === 0) return null

  const histories = Object.fromEntries(
    currencies.map((currency) => [currency, buildMarketHistory(currency, blocks[currency] ?? [])]),
  ) as Record<string, MarketHistory>

  const totalMissing = Object.values(progress).reduce((sum, p) => sum + p.total, 0)
  const totalDone = Object.values(progress).reduce((sum, p) => sum + p.done, 0)
  const detailLive = detail ? pools.blocks.find((block) => block.currency === detail) : undefined

  return (
    <section className="mt-1" aria-labelledby="market-rate-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="market-rate-title" className="text-sm font-semibold text-ink">
          When to send the harvest
        </h3>
        <p className="text-xs text-faint">
          What a biopoint earned in the last {HISTORY_BLOCKS} blocks of your tier, read off the chain.
        </p>
      </div>

      {syncing && totalMissing > 0 ? (
        <div className="mt-2" role="status" aria-live="polite">
          <p className="tabular text-xs text-muted">
            Reading settled blocks from the explorer: {totalDone} of {totalMissing}. Takes a while the first
            time; you can leave this tab and come back.
          </p>
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-3">
            <span
              className="block h-full bg-accent transition-[width] duration-300"
              style={{ width: `${totalMissing > 0 ? (totalDone / totalMissing) * 100 : 0}%` }}
            />
          </span>
        </div>
      ) : null}

      {failed ? (
        <p role="alert" className="mt-2 text-xs text-[color:var(--danger)]">
          The explorer did not answer for some blocks. What was read is shown; the rest is retried on the
          next pass.
        </p>
      ) : null}

      <ul className="mt-2.5 grid gap-2 md:grid-cols-3">
        {currencies.map((currency) => {
          const live = pools.blocks.find((block) => block.currency === currency)
          const history = histories[currency]
          if (!live || !history) return null
          return (
            <CurrencyCard
              key={currency}
              pools={pools}
              live={live}
              history={history}
              progress={progress[currency] ?? null}
              onDetails={() => setDetail(currency)}
            />
          )
        })}
      </ul>

      <p className="mt-2 text-xs text-faint">
        A block pays a fixed amount split by contributed weight, so a biopoint earns most in the blocks few
        people send to. Hours are local. Sell means contribute the harvest to that block; nothing here
        touches your game.
      </p>

      <HistoryModal
        currency={detail}
        history={detail ? (histories[detail] ?? null) : null}
        minute={detailLive ? new Date(detailLive.endDate).getMinutes() : 49}
        onClose={() => setDetail(null)}
      />
    </section>
  )
}

