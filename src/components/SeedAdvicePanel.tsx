import type { ReactNode } from 'react'
import { Merge, Sprout, TriangleAlert } from 'lucide-react'
import type { MergeStep, SeedAdvice, SeedGap } from '../lib/seedAdvice'
import type { Rarity } from '../lib/types'
import { RarityBadge } from './ui'

/** "2× [Common] Peas seeds": count, then rarity as colour plus word, then the name. */
function ItemCount({ count, rarity, name }: { count: number; rarity: Rarity | null; name: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular font-semibold text-ink">{count}×</span>
      {rarity ? <RarityBadge rarity={rarity} /> : null}
      <span className="text-ink">{name}</span>
    </span>
  )
}

function MergeLine({ step, showTimes = true }: { step: MergeStep; showTimes?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {step.inputs.map((input) => (
        <ItemCount key={input.code} count={input.count} rarity={input.rarity} name={input.name} />
      ))}
      <span aria-hidden="true" className="text-faint">
        →
      </span>
      <span className="sr-only">makes</span>
      <ItemCount count={step.output.count} rarity={step.output.rarity} name={step.output.name} />
      {showTimes && step.times > 1 ? (
        <span className="tabular text-xs text-muted">· {step.times} times</span>
      ) : null}
      {step.currency ? (
        <span className="text-xs text-muted">· also costs {step.currency}, amount shown in the game</span>
      ) : null}
    </span>
  )
}

function GapFixLine({ gap }: { gap: SeedGap }) {
  const { fix } = gap
  if (fix.kind === 'merge') {
    return (
      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Merge from your spare seeds:</span>
        <MergeLine step={fix.step} showTimes={false} />
      </p>
    )
  }
  if (fix.kind === 'short') {
    const short = fix.have
      .filter((item) => item.spare < item.count)
      .map((item) => `${item.count} ${item.name.toLowerCase()} (you have ${item.spare} spare)`)
      .join(', ')
    return (
      <p className="mt-1.5 text-xs text-muted">
        A recipe makes it, but it needs {short}. Grow or get those first.
      </p>
    )
  }
  return (
    <p className="mt-1.5 text-xs text-muted">
      No captured recipe makes this seed. Buy it, win it, or scroll the Workshop for more recipes.
    </p>
  )
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        {icon}
        {title}
        <span className="tabular text-xs font-normal text-faint">{count}</span>
      </h3>
      {children}
    </section>
  )
}

/**
 * What to merge, what to keep, and what is missing.
 *
 * Missing comes first because it is the only part that unlocks something new; merges are a
 * level-up, and the keep list is there to explain the merges that are NOT suggested.
 */
export function SeedAdvicePanel({ advice }: { advice: SeedAdvice }) {
  const { missing, merges, keep, recipesKnown, recipesTotal, hasMergeRecipes } = advice
  const partial = recipesTotal !== null && recipesTotal > recipesKnown

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Merging is one way: merge your last seed of a rarity and no feed that asks for that harvest
        can be made again. Seeds your plan plants and seeds your animals' feed needs are kept
        first; only what is left over is merged.
      </p>

      {partial ? (
        <p className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          {recipesKnown} of {recipesTotal} recipes captured. Open the Workshop in the game, scroll it
          to the end, then sync again for advice on every seed.
        </p>
      ) : null}
      {!hasMergeRecipes ? (
        <p className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          No seed merge recipe captured yet, so nothing can be suggested to merge. Open the Workshop
          in the game, then sync again.
        </p>
      ) : null}

      <Section
        icon={<TriangleAlert size={15} aria-hidden="true" className="text-[color:var(--warning)]" />}
        title="Missing"
        count={missing.length}
      >
        {missing.length === 0 ? (
          <p className="text-sm text-muted">Every feed your animals eat has its seeds covered.</p>
        ) : (
          <ul className="grid gap-2">
            {missing.map((gap) => (
              <li key={gap.code} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <RarityBadge rarity={gap.rarity} />
                  <span className="font-semibold text-ink">{gap.name}</span>
                  {gap.blocking ? (
                    <span className="text-xs text-[color:var(--warning)]">
                      an animal has no feed it can keep making without it
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-faint">For {gap.unlocks.join(', ')}</p>
                <GapFixLine gap={gap} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Merge size={15} aria-hidden="true" className="text-accent" />} title="Safe to merge" count={merges.length}>
        {merges.length === 0 ? (
          <p className="text-sm text-muted">
            {hasMergeRecipes
              ? 'Nothing spare to merge: every seed you hold is planted or feeds an animal.'
              : 'Waiting for merge recipes from the Workshop.'}
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {merges.map((step) => (
              <li key={`${step.offerCode}-${step.inputs[0]?.code ?? ''}`} className="rounded-lg px-1 py-1">
                <MergeLine step={step} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Sprout size={15} aria-hidden="true" className="text-muted" />} title="Keep" count={keep.length}>
        {keep.length === 0 ? (
          <p className="text-sm text-muted">No seed is planted by the plan or needed for feed.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <caption className="sr-only">Seeds to keep and why</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-faint">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Seed
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Keep
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Held
                  </th>
                  <th scope="col" className="py-1.5 pl-3 font-medium">
                    Why
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {keep.map((holding) => (
                  <tr key={holding.code}>
                    <td className="py-2 pr-3">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <RarityBadge rarity={holding.rarity} />
                        <span className="text-ink">{holding.name}</span>
                      </span>
                    </td>
                    <td className="tabular px-3 py-2 text-right font-semibold text-ink">{holding.keep}</td>
                    <td className="tabular px-3 py-2 text-right text-muted">{holding.owned}</td>
                    <td className="py-2 pl-3 text-xs text-muted">{holding.reasons.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
