import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { buildPoolHistory } from '../lib/pools'
import { useMarketHistory } from '../lib/useMarketHistory'
import { useStore } from '../store'
import {
  BagCard,
  HistoryDoors,
  PoolsNow,
  Recommendation,
  StatusPill,
  TierLadder,
  Trends,
} from './MarketRate'
import { BareFrame, Card } from './ui'

/** Currency amounts arrive as integers scaled by the currency's own decimal factor. */
function scaled(amount: number, currency: string): string {
  const factor = 1e9
  const value = amount / factor
  if (value === 0) return '0'
  const text = value >= 1
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value.toLocaleString(undefined, { maximumSignificantDigits: 4 })
  return `${text} ${currency}`.trim()
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/**
 * The pools tab: what tier you are in, what is in the pools right now, where the bag should
 * go and when, what each closing hour usually looks like, and what you have been paid.
 *
 * Everything about the market comes from the chain through one hook; the game capture
 * supplies the tier, the live blocks and your own payouts.
 */
export function PoolsPanel({ bare = false }: { bare?: boolean }) {
  const Frame = bare ? BareFrame : Card
  const pools = useStore((state) => state.inventory.pools)
  const history = useMemo(() => buildPoolHistory(pools), [pools])
  const market = useMarketHistory()

  if (pools.blocks.length === 0 && !pools.level) {
    return (
      <Frame title="Reward pools">
        <p className="text-sm text-muted">
          Nothing captured yet. Go to chainers.io with the extension installed and reload the farm page; loading the farm is all the capture needs. Then press Sync now here.
        </p>
      </Frame>
    )
  }

  return (
    <Frame title="Reward pools" description="Your tier, the pools right now, and where the bag is worth most.">
      <div className="flex flex-col gap-4">
        {pools.blocks.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusPill market={market} />
            {market.unknownCurrencies.length > 0 ? (
              <p role="alert" className="text-xs text-[color:var(--warning)]">
                Currency not mapped to a token: {market.unknownCurrencies.join(', ')}. Report it.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted">
            No live block in the capture. Go to chainers.io with the extension installed and reload the farm page; loading the farm is all the capture needs. Then press Sync now here.
          </p>
        )}

        <div className="grid gap-2 md:grid-cols-[1.3fr_1fr]">
          <TierLadder pools={pools} />
          <BagCard market={market} />
        </div>

        {pools.blocks.length > 0 ? (
          <>
            <section aria-labelledby="pools-now-title">
              <h3 id="pools-now-title" className="mb-2 text-sm font-semibold text-ink">
                Pools right now
              </h3>
              <PoolsNow pools={pools} market={market} />
            </section>

            <Recommendation pools={pools} market={market} />

            <Trends market={market} />

            <HistoryDoors market={market} />
          </>
        ) : null}

        <p className="text-xs text-faint">
          A block pays a fixed amount split by contributed weight, so a biopoint earns most in the blocks few
          people send to. Estimates add your bag to the block and assume it ends near this hour's usual weight.
          Nothing here touches your game.
        </p>

        {history.count > 0 ? (
          <div className="border-t border-line pt-3">
            <h3 className="text-sm font-semibold text-ink">What you have been paid</h3>

            <div className="mt-2 overflow-x-auto scroll-thin">
              <table className="w-full min-w-[26rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-faint uppercase">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Currency</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">24h</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">7 days</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">30 days</th>
                    <th scope="col" className="py-1.5 pl-3 text-right font-medium">Blocks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {history.totals.map((total) => (
                    <tr key={total.currency}>
                      <td className="py-1.5 pr-3 text-ink">{total.currency}</td>
                      <td className="tabular px-3 py-1.5 text-right text-ink">{scaled(total.day, '')}</td>
                      <td className="tabular px-3 py-1.5 text-right text-muted">{scaled(total.week, '')}</td>
                      <td className="tabular px-3 py-1.5 text-right text-muted">{scaled(total.month, '')}</td>
                      <td className="tabular py-1.5 pl-3 text-right text-faint">{total.blocks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {history.bestHours.length > 0 ? (
              <div className="mt-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
                  <Clock size={13} aria-hidden="true" className="text-muted" />
                  Your best blocks so far, by what a biopoint earned you
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {history.bestHours.map((hour) => (
                    <li key={hour.hour} className="tabular rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs">
                      <span className="font-semibold text-accent">{hourLabel(hour.hour)}</span>
                      <span className="mx-1.5 text-faint">·</span>
                      <span className="text-muted">{hour.blocks} block{hour.blocks === 1 ? '' : 's'}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-faint">
                  {history.thin
                    ? `Only ${history.count} settled block${history.count === 1 ? '' : 's'} of yours so far; the market section above is the one with enough data.`
                    : 'From your own settled blocks; the market section above covers every block, yours or not.'}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-faint">
            No settled blocks of yours captured yet. Reload the farm page in chainers.io and sync again; your own
            earnings appear here once the game has reported them.
          </p>
        )}
      </div>
    </Frame>
  )
}
