import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { buildIconLookup } from '../lib/artwork'
import { getSeed } from '../lib/catalog'
import { stackKey } from '../lib/yield'
import { useStore } from '../store'
import { Card, CheckSwitch, RarityBadge, TextInput } from './ui'

/**
 * The seeds the player owns, each switchable.
 *
 * The old version let you type counts, which invited the question "counts of what, exactly?"
 * — the numbers come from the game and editing them just desynced the plan from reality. What
 * a player actually wants here is narrower: leave a seed out of the plan. So the only control
 * is a switch, and the count is shown, not edited.
 */
export function SeedsCard() {
  const stacks = useStore((state) => state.inventory.seeds)
  const disabledSeeds = useStore((state) => state.disabledSeeds)
  const toggleSeed = useStore((state) => state.toggleSeed)
  const catalogue = useStore((state) => state.catalogue)

  const [query, setQuery] = useState('')
  const iconFor = useMemo(() => buildIconLookup(catalogue), [catalogue])
  const disabled = useMemo(() => new Set(disabledSeeds), [disabledSeeds])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return stacks
      .map((stack) => ({ stack, seed: getSeed(stack.seedId) }))
      .filter(({ seed }) => Boolean(seed))
      .filter(({ seed }) => (needle ? seed!.name.toLowerCase().includes(needle) : true))
      .sort((a, b) => a.seed!.name.localeCompare(b.seed!.name))
  }, [stacks, query])

  const active = rows.filter(({ stack }) => !disabled.has(stackKey(stack.seedId, stack.rarity)))

  if (stacks.length === 0) {
    return (
      <Card title="Your seeds">
        <p className="text-sm text-muted">
          No seeds loaded yet, so the plan uses the whole catalogue. Sync your farm to plan with
          what you actually own.
        </p>
      </Card>
    )
  }

  return (
    <Card
      title="Your seeds"
      description={`${active.length} of ${rows.length} in use`}
    >
      {rows.length > 6 ? (
        <div className="relative mb-2">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
          />
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your seeds"
            aria-label="Search your seeds"
            className="pl-8"
          />
        </div>
      ) : null}

      <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto scroll-thin">
        {rows.map(({ stack, seed }) => {
          const key = stackKey(stack.seedId, stack.rarity)
          const on = !disabled.has(key)
          const icon = iconFor(stack.seedId, stack.rarity)

          return (
            <li key={key}>
              <CheckSwitch
                checked={on}
                onChange={() => toggleSeed(key)}
                icon={
                  icon ? (
                    <img src={icon} alt="" width={24} height={24} loading="lazy" className="size-6" />
                  ) : null
                }
                label={
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{seed!.name}</span>
                    <span className="tabular shrink-0 text-muted">
                      {seed!.renewable ? '∞' : `×${stack.count}`}
                    </span>
                  </span>
                }
                hint={<RarityBadge rarity={stack.rarity} />}
              />
            </li>
          )
        })}
      </ul>

      <p className="mt-2 text-xs text-faint">
        <span className="tabular">∞</span> regrows on harvest; a number is one-shot. Switch one
        off to keep it out of the plan.
      </p>
    </Card>
  )
}
