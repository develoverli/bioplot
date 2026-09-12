import { AlertTriangle } from 'lucide-react'
import { getLand } from '../lib/catalog'
import { formatBiopoints, formatDuration, formatExact, titleCase } from '../lib/format'
import type { Plan } from '../lib/optimizer'
import { BareFrame, Card, EmptyState, RarityBadge } from './ui'

export function PlanPanel({ plan, bare = false }: { plan: Plan; bare?: boolean }) {
  const hours = plan.horizonSec / 3600
  const Frame = bare ? BareFrame : Card

  return (
    <Frame
      title="What to plant"
      description={`The schedule that banks the most biopoints in ${hours}h. Only harvests that finish inside the window count.`}
    >
      {plan.warnings.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {plan.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-sm text-muted">
              <AlertTriangle
                size={16}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-[color:var(--warning)]"
              />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {plan.plots.length === 0 ? (
        <EmptyState
          title="Nothing to plan yet"
          hint="Add a plot group and the schedule appears here."
        />
      ) : (
        <div className="flex flex-col divide-y divide-[color:var(--border)]">
          {plan.plots.map((plotPlan, index) => (
            <article key={`${plotPlan.groupId}-${index}`} className="py-4 first:pt-0 last:pb-0">
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-sm font-semibold text-ink">
                    {plotPlan.plots}× {titleCase(plotPlan.plotRarity)} plot
                  </h3>
                  <RarityBadge rarity={plotPlan.plotRarity} />
                  <span className="text-xs text-muted">{getLand(plotPlan.landId).name}</span>
                  <span className="text-xs text-muted">
                    {plotPlan.lamp ? `${titleCase(plotPlan.lamp)} lamp` : 'no lamp'}
                  </span>
                </div>
                <p
                  className="tabular text-sm font-semibold text-accent"
                  title={formatExact(plotPlan.biopoints)}
                >
                  {formatBiopoints(plotPlan.biopoints)} bp
                </p>
              </header>

              {plotPlan.entries.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  Nothing can be planted here. Water seeds only grow on water land, and soil seeds
                  only on soil land.
                </p>
              ) : (
                <div className="mt-2 overflow-x-auto scroll-thin">
                  <table className="w-full min-w-[32rem] border-collapse text-sm">
                    <caption className="sr-only">
                      Plantings for one {plotPlan.plotRarity} plot over {hours} hours
                    </caption>
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-faint">
                        <th scope="col" className="py-1.5 pr-3 font-medium">
                          Seed
                        </th>
                        <th scope="col" className="px-3 py-1.5 font-medium">
                          Rarity
                        </th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium">
                          Grow
                        </th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium">
                          Plantings
                        </th>
                        <th scope="col" className="py-1.5 pl-3 text-right font-medium">
                          Biopoints
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {plotPlan.entries.map((entry) => (
                        <tr key={`${entry.seedId}-${entry.rarity}`}>
                          <td className="py-1.5 pr-3">
                            <span className="text-ink">{entry.seedName}</span>
                            {entry.renewable ? null : (
                              <span className="ml-2 text-[11px] text-faint">one-shot</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <RarityBadge rarity={entry.rarity} />
                          </td>
                          <td className="tabular px-3 py-1.5 text-right text-muted">
                            {formatDuration(entry.growthSec)}
                          </td>
                          <td className="tabular px-3 py-1.5 text-right text-ink">
                            ×{entry.plantings}
                          </td>
                          <td
                            className="tabular py-1.5 pl-3 text-right text-ink"
                            title={formatExact(entry.biopointsTotal)}
                          >
                            {formatBiopoints(entry.biopointsTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="mt-2 text-xs text-faint">
                {formatBiopoints(plotPlan.biopointsPerPlot)} bp per plot, with{' '}
                {formatDuration(plotPlan.idleSec)} idle.
              </p>
            </article>
          ))}
        </div>
      )}
    </Frame>
  )
}
