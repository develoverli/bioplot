import { describe, expect, it } from 'vitest'
import { getSeed } from './catalog'
import { buildEffectiveSeeds } from './effective'
import { emptyCatalogue, type Catalogue, type CatalogueEntry } from './types'

function entry(overrides: Partial<CatalogueEntry> & Pick<CatalogueEntry, 'name' | 'rarity'>): CatalogueEntry {
  return {
    code: `${overrides.rarity}_${overrides.name}`,
    biopoints: null,
    growthSec: null,
    image: null,
    ...overrides,
  }
}

function catalogue(overrides: Partial<Catalogue> = {}): Catalogue {
  return { ...emptyCatalogue, ...overrides }
}

const cornLegendary = () => {
  const seed = getSeed('corn-seed')
  if (!seed) throw new Error('fixture missing')
  return seed.variants.legendary!
}

describe('buildEffectiveSeeds', () => {
  it('falls back to the docs when nothing was captured', () => {
    const effective = buildEffectiveSeeds(catalogue())
    const corn = effective.seeds.find((seed) => seed.id === 'corn-seed')

    expect(corn?.variants.legendary).toEqual(cornLegendary())
    expect(effective.liveVariants).toBe(0)
    expect(effective.docVariants).toBeGreaterThan(200)
  })

  it('prefers the game biopoints over the docs', () => {
    const effective = buildEffectiveSeeds(
      catalogue({ vegetables: [entry({ name: 'corn', rarity: 'legendary', biopoints: 4242 })] }),
    )
    const corn = effective.seeds.find((seed) => seed.id === 'corn-seed')

    expect(corn?.variants.legendary?.biopoints).toBe(4242)
    // Growth was not reported, so the docs value survives.
    expect(corn?.variants.legendary?.growthSec).toBe(cornLegendary().growthSec)
    expect(effective.liveVariants).toBe(1)
  })

  it('prefers the game growth time too', () => {
    const effective = buildEffectiveSeeds(
      catalogue({ seeds: [entry({ name: 'corn', rarity: 'legendary', growthSec: 999 })] }),
    )
    const corn = effective.seeds.find((seed) => seed.id === 'corn-seed')

    expect(corn?.variants.legendary?.growthSec).toBe(999)
    expect(corn?.variants.legendary?.biopoints).toBe(cornLegendary().biopoints)
  })

  it('merges biopoints from vegetables with growth from seeds', () => {
    const effective = buildEffectiveSeeds(
      catalogue({
        vegetables: [entry({ name: 'corn', rarity: 'legendary', biopoints: 500 })],
        seeds: [entry({ name: 'corn', rarity: 'legendary', growthSec: 60 })],
      }),
    )
    const corn = effective.seeds.find((seed) => seed.id === 'corn-seed')

    expect(corn?.variants.legendary).toEqual({ biopoints: 500, growthSec: 60 })
  })

  it('never invents a family the docs do not describe', () => {
    // Renewability and water/soil are not in the catalogue, so an unknown row is reported
    // rather than guessed into the planner.
    const effective = buildEffectiveSeeds(
      catalogue({ vegetables: [entry({ name: 'bird_food', rarity: 'epic', biopoints: 10 })] }),
    )

    expect(effective.seeds.some((seed) => seed.name.includes('bird'))).toBe(false)
    expect(effective.unmatched).toContain('bird_food')
  })

  it('leaves other rarities of the same seed alone', () => {
    const effective = buildEffectiveSeeds(
      catalogue({ vegetables: [entry({ name: 'corn', rarity: 'legendary', biopoints: 4242 })] }),
    )
    const corn = effective.seeds.find((seed) => seed.id === 'corn-seed')
    const docsCorn = getSeed('corn-seed')

    expect(corn?.variants.common).toEqual(docsCorn?.variants.common)
  })
})
