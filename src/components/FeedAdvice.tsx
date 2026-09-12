import { CircleAlert, Sprout, TriangleAlert } from 'lucide-react'
import type { FarmAnimal, FeedNeed } from '../lib/feed'
import { RarityBadge } from './ui'

/**
 * What to put in the pen, and when the honest answer is "nothing yet, here is why".
 *
 * Feed you hold is not feed you can make. A legendary feed from an event runs out and the
 * recipe behind it may be out of reach, so the recommendation is always the strongest feed
 * you can actually craft, and holding something better is called out as stock, not as a
 * plan. With nothing craftable, the closest recipe is spelled out ingredient by ingredient:
 * what is short, and which seed would end the shortage for good.
 */
function NeedRow({ need }: { need: FeedNeed }) {
  const short = need.owned < need.count
  return (
    <li className="tabular flex flex-wrap items-baseline gap-x-2 text-xs">
      <span className={short ? 'text-ink' : 'text-muted'}>
        {need.count}× {need.name}
      </span>
      <span className={short ? 'text-[color:var(--danger)]' : 'text-faint'}>
        you have {need.owned}
      </span>
      {/* The seed is the supply; it is shown whether or not the bag is full today. */}
      <span className={need.hasSeed ? 'text-accent' : short ? 'text-[color:var(--danger)]' : 'text-[color:var(--warning)]'}>
        {need.hasSeed ? `seed owned: ${need.seed}` : `no seed: ${need.seed}`}
      </span>
    </li>
  )
}

export function FeedAdvice({ animal }: { animal: FarmAnimal }) {
  const { recommended, stockOnly, nearest, feeds } = animal

  if (feeds.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted">
        No feed for this pen appears in the capture. Open the Workshop and the animals screen in
        chainers.io, then sync again.
      </p>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {recommended ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-[color:var(--accent)] bg-accent-dim px-2.5 py-2">
          {recommended.image ? (
            <img src={recommended.image} alt="" width={32} height={32} className="size-8 shrink-0" />
          ) : (
            <Sprout size={18} aria-hidden="true" className="mt-1 shrink-0 text-accent" />
          )}
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-ink">
              Give {recommended.name}
              <RarityBadge rarity={recommended.rarity} />
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {recommended.sustainable
                ? 'You own the seed for every ingredient, so this never runs out.'
                : `You can craft ${recommended.craftable} now from the harvest you hold, but not again: no seed for ${recommended.cannotGrow.join(' or ')}.`}
            </p>
          </div>
        </div>
      ) : (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-[color:var(--danger)]/60 bg-[color:var(--danger)]/10 px-2.5 py-2"
        >
          {nearest?.feed.image ? (
            <img
              src={nearest.feed.image}
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0"
              style={{ filter: 'grayscale(1)', opacity: 0.6 }}
            />
          ) : (
            <CircleAlert size={18} aria-hidden="true" className="mt-1 shrink-0 text-[color:var(--danger)]" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">No feed you can make for this pen</p>
            {nearest ? (
              <>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  Closest: <span className="font-medium text-ink">{nearest.feed.name}</span>
                  <RarityBadge rarity={nearest.feed.rarity} />
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {nearest.short.map((need) => (
                    <NeedRow key={need.code} need={need} />
                  ))}
                </ul>
                <p className="mt-1 text-xs text-faint">
                  {nearest.short.every((need) => need.hasSeed)
                    ? 'You own every seed: grow them and this feed is yours for good.'
                    : `Buy ${nearest.short
                        .filter((need) => !need.hasSeed)
                        .map((need) => need.seed)
                        .join(' and ')} and it never runs out.`}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-xs text-muted">
                The recipes are not in the capture. Open the Workshop in chainers.io, then sync.
              </p>
            )}
          </div>
        </div>
      )}

      {stockOnly && (!recommended || stockOnly.code !== recommended.code) ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-[color:var(--warning)]/60 bg-[color:var(--warning)]/10 px-2.5 py-2">
          <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[color:var(--warning)]" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-ink">
              You hold {stockOnly.owned}× {stockOnly.name}
              <RarityBadge rarity={stockOnly.rarity} />
              <span className="font-normal text-muted">but cannot make more</span>
            </p>
            {stockOnly.needs.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {stockOnly.needs
                  .filter((need) => need.owned < need.count || !need.hasSeed)
                  .map((need) => (
                    <NeedRow key={need.code} need={need} />
                  ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-xs text-faint">Its recipe is not in the capture.</p>
            )}
            <p className="mt-1 text-xs text-faint">
              Use it while it lasts; the plan counts on {recommended ? recommended.name : 'nothing'} after
              that.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
