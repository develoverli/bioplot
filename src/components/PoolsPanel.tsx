import { useMemo } from 'react'
import { Clock, ExternalLink, Trophy } from 'lucide-react'
import { formatBiopoints, formatDuration, formatExact, formatPercent } from '../lib/format'
import { buildPoolHistory } from '../lib/pools'
import type { Pools } from '../lib/types'
import { useStore } from '../store'
import { MarketRate } from './MarketRate'
import { BareFrame, Card } from './ui'

/**
 * What your biopoints are actually worth.
 *
 * A reward pool pays a fixed amount per block, split by contributed weight. So the only
 * number that turns biopoints into currency is your share: `yourWeight / totalWeight`. The
 * game reports both, per live block, which makes the payout computable rather than guessed.
 */
function shareOf(userWeight: number, totalWeight: number): number {
  return totalWeight > 0 ? userWeight / totalWeight : 0
}

/** Currency amounts arrive as integers scaled by the currency's own decimal factor. */
function scaled(amount: number, currency: string): string {
  // CFB and the internal currencies use 1e9; showing the raw integer would be meaningless.
  const factor = 1e9
  const value = amount / factor
  if (value === 0) return '0'
  if (value < 0.0001) return `<0.0001 ${currency}`
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currency}`
}

function remaining(endDate: string): string {
  const end = Date.parse(endDate)
  if (Number.isNaN(end)) return '—'
  const left = Math.max(0, Math.round((end - Date.now()) / 1000))
  return left === 0 ? 'closed · sync again' : formatDuration(left)
}

/**
 * Your tier, counted the way a player counts.
 *
 * The API is zero-based: `level: 0` is the first tier, which reads as "Tier 0" only to a
 * programmer. `levels-config` carries each rung's `pointsToClaim`, so the gap to the next one
 * is a subtraction rather than a mystery.
 */
function TierBadge({ pools }: { pools: Pools }) {
  const level = pools.level
  if (!level) return null

  const next = pools.levels.find((tier) => tier.level === level.level + 1)
  const toGo = next ? Math.max(0, next.pointsToClaim - level.points) : 0
  const previous = pools.levels.find((tier) => tier.level === level.level)?.pointsToClaim ?? 0
  const span = next ? Math.max(1, next.pointsToClaim - previous) : 1
  const progress = next ? Math.min(1, Math.max(0, (level.points - previous) / span)) : 1

  return (
    <span className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
      {level.icon ? (
        <img src={level.icon} alt="" width={22} height={22} className="size-5.5" />
      ) : (
        <Trophy size={16} aria-hidden="true" className="text-[color:var(--warning)]" />
      )}

      <span className="flex flex-col">
        <span className="text-sm font-semibold text-ink">Tier {level.level + 1}</span>
        <span className="tabular text-xs text-muted" title={formatExact(level.points)}>
          {formatBiopoints(level.points)} bp
          {next ? (
            <>
              <span className="mx-1 text-faint">·</span>
              {formatBiopoints(toGo)} to tier {next.level + 1}
            </>
          ) : (
            <>
              <span className="mx-1 text-faint">·</span>top tier
            </>
          )}
        </span>
      </span>

      {next ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3"
        >
          <span
            className="block h-full bg-accent"
            style={{ width: `${(progress * 100).toFixed(1)}%` }}
          />
        </span>
      ) : null}
    </span>
  )
}

/** Local hour as a label the reader can act on. */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

export function PoolsPanel({ bare = false }: { bare?: boolean }) {
  const Frame = bare ? BareFrame : Card
  const pools = useStore((state) => state.inventory.pools)
  const history = useMemo(() => buildPoolHistory(pools), [pools])

  if (pools.blocks.length === 0 && !pools.level) {
    return (
      <Frame title="Reward pools">
        <p className="text-sm text-muted">
          Nothing captured yet. Open the Reward Pool window in chainers.io once, then sync again.
        </p>
      </Frame>
    )
  }

  const iconFor = (groupCode: string) =>
    pools.groups.find((group) => group.groupCode === groupCode)?.icon ?? null

  const titleFor = (groupCode: string) =>
    pools.groups.find((group) => group.groupCode === groupCode)?.title ?? groupCode

  return (
    <Frame
      title="Reward pools"
      description="Your share of each live block, and what it pays if it closed now."
      actions={pools.level ? <TierBadge pools={pools} /> : null}
    >
      {pools.blocks.length === 0 ? (
        <p className="text-sm text-muted">No live blocks in the capture.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pools.blocks.map((block) => {
            const share = shareOf(block.userWeight, block.totalWeight)
            return (
              <li
                key={block.code}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5"
              >
                <span className="flex min-w-40 items-center gap-2">
                  {iconFor(block.groupCode) ? (
                    <img
                      src={iconFor(block.groupCode)!}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6"
                    />
                  ) : null}
                  <span className="text-sm font-medium text-ink">
                    {titleFor(block.groupCode)}
                  </span>
                </span>

                <span className="tabular text-xs text-muted">
                  <span className="font-semibold text-ink">{formatPercent(share, 4)}</span> of the
                  block
                  <span className="mx-1.5 text-faint">·</span>
                  {formatBiopoints(block.userWeight)} of {formatBiopoints(block.totalWeight)} bp
                </span>

                <span className="tabular text-sm font-semibold text-accent">
                  {scaled(block.payout * share, block.currency)}
                </span>

                <span className="tabular ml-auto text-xs text-faint">
                  {remaining(block.endDate).startsWith('closed') ? remaining(block.endDate) : `closes in ${remaining(block.endDate)}`}
                </span>

                {block.explorerURL ? (
                  <a
                    href={block.explorerURL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-faint hover:text-accent"
                    aria-label={`${titleFor(block.groupCode)} block on the explorer`}
                    title="Open on the explorer"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-faint">
        Payout is your current share of the block if it closed right now. It moves as other
        players contribute, so it is a reading, not a promise.
      </p>

      <div className="mt-4 border-t border-line pt-3">
        <MarketRate />
      </div>

      {history.count > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-sm font-semibold text-ink">What you have been paid</h3>

          <div className="mt-2 overflow-x-auto scroll-thin">
            <table className="w-full min-w-[26rem] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-faint">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Currency
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    24h
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    7 days
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    30 days
                  </th>
                  <th scope="col" className="py-1.5 pl-3 text-right font-medium">
                    Blocks
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {history.totals.map((total) => (
                  <tr key={total.currency}>
                    <td className="py-1.5 pr-3 text-ink">{total.currency}</td>
                    <td className="tabular px-3 py-1.5 text-right text-ink">
                      {scaled(total.day, '')}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-muted">
                      {scaled(total.week, '')}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-muted">
                      {scaled(total.month, '')}
                    </td>
                    <td className="tabular py-1.5 pl-3 text-right text-faint">{total.blocks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            A block pays a fixed amount split by weight, so the rate per biopoint is highest
            when few people contributed. Past blocks are the only evidence of when that is.
          */}
          {history.bestHours.length > 0 ? (
            <div className="mt-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <Clock size={13} aria-hidden="true" className="text-muted" />
                Best blocks to be in, by what a biopoint earned
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {history.bestHours.map((hour) => (
                  <li
                    key={hour.hour}
                    className="tabular rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs"
                  >
                    <span className="font-semibold text-accent">{hourLabel(hour.hour)}</span>
                    <span className="mx-1.5 text-faint">·</span>
                    <span className="text-muted">
                      {hour.blocks} block{hour.blocks === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-faint">
                {history.thin
                  ? `Only ${history.count} settled block${
                      history.count === 1 ? '' : 's'
                    } so far — not enough to call these the best hours yet. Sync again over a few days.`
                  : 'Hours are local. A block pays a fixed amount split by contributed weight, so the fewer people contributing, the more each biopoint earns.'}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-faint">
          No settled blocks captured. Open the History tab in the Reward Pool window, then sync
          again, and per-day earnings and the best hours appear here.
        </p>
      )}
    </Frame>
  )
}
