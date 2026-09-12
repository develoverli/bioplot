import { seeds as docSeeds } from './catalog'
import { matchSeedId } from './inventory'
import type { Catalogue, CatalogueEntry, Rarity, Seed } from './types'

/**
 * The numbers the planner actually runs on.
 *
 * `data/seeds.json` is transcribed from the public docs and can drift. The game's own
 * catalogue reports `rewardPoolBaseWeight` per crop, which IS the biopoint weight the reward
 * pool uses, plus the real growth times. When a capture carries those, they win.
 *
 * The docs stay as the base layer, because they cover families the capture may not include
 * and they carry facts the catalogue does not report at all: whether a seed regrows, and
 * whether it needs water.
 */
export interface EffectiveSeeds {
  seeds: Seed[]
  /** Variants whose numbers came from the game rather than from the docs. */
  liveVariants: number
  /** Variants still using the docs. */
  docVariants: number
  /** Catalogue rows that matched no known seed family. */
  unmatched: string[]
}

function indexCatalogue(catalogue: Catalogue): Map<string, CatalogueEntry> {
  const byKey = new Map<string, CatalogueEntry>()

  // Vegetables carry the biopoint weight; seeds carry growth. Later writes merge into earlier.
  for (const source of [catalogue.vegetables, catalogue.seeds]) {
    for (const entry of source) {
      const seedId = matchSeedId(entry.name)
      if (!seedId) continue

      const key = `${seedId}|${entry.rarity}`
      const previous = byKey.get(key)
      byKey.set(key, {
        ...entry,
        biopoints: entry.biopoints ?? previous?.biopoints ?? null,
        growthSec: entry.growthSec ?? previous?.growthSec ?? null,
        image: entry.image ?? previous?.image ?? null,
      })
    }
  }

  return byKey
}

export function buildEffectiveSeeds(catalogue: Catalogue): EffectiveSeeds {
  const live = indexCatalogue(catalogue)

  let liveVariants = 0
  let docVariants = 0

  const seeds = docSeeds.map((seed) => {
    const variantEntries: [Rarity, NonNullable<Seed['variants'][Rarity]>][] = []

    for (const [rarity, variant] of Object.entries(seed.variants) as [Rarity, Seed['variants'][Rarity]][]) {
      if (!variant) continue

      const key = `${seed.id}|${rarity}`
      const entry = live.get(key)
      const biopoints = entry?.biopoints ?? null
      const growthSec = entry?.growthSec ?? null

      if (biopoints !== null || growthSec !== null) {
        liveVariants += 1
      } else {
        docVariants += 1
      }

      variantEntries.push([
        rarity,
        {
          biopoints: biopoints ?? variant.biopoints,
          growthSec: growthSec ?? variant.growthSec,
        },
      ])
    }

    const variants: Seed['variants'] = Object.fromEntries(variantEntries)
    return { ...seed, variants }
  })

  const unmatched: string[] = []
  for (const source of [catalogue.vegetables, catalogue.seeds]) {
    for (const entry of source) {
      if (!matchSeedId(entry.name)) unmatched.push(entry.name)
    }
  }

  return { seeds, liveVariants, docVariants, unmatched: [...new Set(unmatched)] }
}
