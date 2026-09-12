import { useMemo } from 'react'
import { PawPrint } from 'lucide-react'
import { buildFeedReport } from '../lib/feed'
import { formatBiopoints, formatDuration } from '../lib/format'
import { useStore } from '../store'
import { BareFrame, Card, RarityBadge } from './ui'

/**
 * Animals and the feed you could make for them.
 *
 * Deliberately stops at "how much feed you can craft". The game has not been seen to report
 * how much an animal eats per day, and a made-up feeding rate would turn a useful number into
 * a fake one.
 */
export function FeedPanel({ bare = false }: { bare?: boolean }) {
  const Frame = bare ? BareFrame : Card
  const inventory = useStore((state) => state.inventory)
  const catalogue = useStore((state) => state.catalogue)
  const report = useMemo(() => buildFeedReport(inventory, catalogue), [inventory, catalogue])

  if (!report.hasRecipes && report.animals.length === 0) {
    return (
      <Frame title="Animals and feed">
        <p className="text-sm text-muted">
          Nothing captured yet. Open the Workshop and the animals screen in chainers.io, then sync
          again: the recipes and your animals come from there.
        </p>
      </Frame>
    )
  }

  const craftable = report.options.filter((option) => option.crafts > 0)

  return (
    <Frame
      title="Animals and feed"
      description={`${report.animals.length} animal${
        report.animals.length === 1 ? '' : 's'
      }, ${report.hungry} hungry · ${craftable.length} feed recipe${
        craftable.length === 1 ? '' : 's'
      } you can make now`}
    >
      {report.animals.length > 0 ? (
        <ul className="mb-4 flex flex-wrap gap-1.5">
          {report.animals.map((animal) => (
            <li
              key={animal.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs"
            >
              {animal.image ? (
                <img src={animal.image} alt="" width={22} height={22} className="size-5.5" />
              ) : (
                <PawPrint size={14} aria-hidden="true" className="text-muted" />
              )}
              <span className="text-ink">{animal.name}</span>
              <RarityBadge rarity={animal.rarity} />
              {animal.feeding ? (
                <span className="text-faint">fed</span>
              ) : animal.best ? (
                <span className="text-[color:var(--warning)]">
                  give {animal.best.name}
                </span>
              ) : (
                <span className="text-[color:var(--danger)]">no feed</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {craftable.length === 0 ? (
        <p className="text-sm text-muted">
          {report.options.length === 0
            ? 'No feed recipes in the capture. Open the Workshop in chainers.io once, then sync again.'
            : `None of the ${report.options.length} feed recipes can be made from the harvest you hold right now. Grow more crops of the matching rarity: a recipe takes ingredients of its own rarity.`}
        </p>
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[30rem] border-collapse text-sm">
            <caption className="sr-only">Feed you can craft from the harvest you own</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-faint">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Feed
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Crafts
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  Feed made
                </th>
                <th scope="col" className="py-1.5 pl-3 font-medium">
                  Costs each
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {craftable.map((option) => (
                <tr key={option.code}>
                  <td className="py-2 pr-3">
                    <span className="text-ink">{option.name}</span>
                    {option.rarity ? (
                      <span className="ml-2">
                        <RarityBadge rarity={option.rarity} />
                      </span>
                    ) : null}
                    {option.craftingTimeSeconds > 0 ? (
                      <span className="tabular ml-2 text-xs text-faint">
                        {formatDuration(option.craftingTimeSeconds)}
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-ink">{option.crafts}</td>
                  <td className="tabular px-3 py-2 text-right text-ink">
                    {option.feedMin === option.feedMax
                      ? option.feedMin
                      : `${option.feedMin} – ${option.feedMax}`}
                  </td>
                  <td className="py-2 pl-3 text-xs text-muted">
                    {option.cost.map((item) => (
                      <span key={item.code} className="mr-2 whitespace-nowrap">
                        {item.count}× {item.name}
                        <span className="tabular text-faint"> ({item.owned} owned)</span>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.hasOutput ? (
        <p className="mt-3 text-sm text-ink">
          Animals are worth{' '}
          <span className="tabular font-semibold text-accent">
            {formatBiopoints(report.biopointsPerDay)}
          </span>{' '}
          bp / day with the feed you have
          {report.idealBiopointsPerDay > report.biopointsPerDay ? (
            <>
              , and{' '}
              <span className="tabular font-semibold text-[color:var(--warning)]">
                {formatBiopoints(report.idealBiopointsPerDay)}
              </span>{' '}
              if every pen ran its best feed
            </>
          ) : null}
          .
        </p>
      ) : null}

      {report.options.length > craftable.length ? (
        <p className="mt-2 text-xs text-faint">
          {report.options.length - craftable.length} more recipe
          {report.options.length - craftable.length === 1 ? '' : 's'} exist but need ingredients
          you do not have. Recipes take ingredients of their own rarity.
        </p>
      ) : null}

      <p className="mt-2 text-xs text-faint">
        A range means the recipe can roll more than one result. Animal output assumes the produce
        matches the feed's rarity, which is how the rest of the farm behaves but is not stated by
        the game. How much an animal eats per day is not reported at all, so feeding is not
        scheduled.
      </p>
    </Frame>
  )
}
