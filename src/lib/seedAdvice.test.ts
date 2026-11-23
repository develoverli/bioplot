import { describe, expect, it } from 'vitest'
import { emptyInventory } from './inventory'
import type { Plan } from './optimizer'
import { buildSeedAdvice } from './seedAdvice'
import { emptyCatalogue, type Catalogue, type CraftOffer, type Inventory, type InventoryItem } from './types'

const NOW = Date.parse('2026-11-23T12:00:00Z')

/** One placed cow, whose common feed is 2 common peas + 2 common corn. */
function catalogue(): Catalogue {
  return {
    ...emptyCatalogue,
    beds: [
      {
        code: 'common_cattle',
        rarity: 'common',
        groupCode: 'animals',
        typeCode: 'cattle',
        growthTimeModifier: 1,
        compatible: ['milk'],
        image: null,
      },
    ],
    seeds: [
      { code: 'common_cattle_food', rarity: 'common', name: 'cattle_food', biopoints: null, growthSec: 3600, image: null },
    ],
  }
}

const feedOffer: CraftOffer = {
  code: 'common_cattle_food',
  groupCode: 'farmPetFood',
  craftingTimeSeconds: 0,
  recipes: [
    {
      code: 'common_cattle_food',
      isDefault: true,
      requiredItems: [
        { itemType: 'farmVegetable', code: 'common_peas', count: 2 },
        { itemType: 'farmVegetable', code: 'common_corn', count: 2 },
      ],
      resultGroups: [{ code: 'ok', items: [{ itemType: 'farmSeed', code: 'common_cattle_food', count: 3 }] }],
    },
  ],
}

/** "count x from" -> 1 "to", the shape every captured seed merge has had. */
function merge(from: string, to: string, count = 2, extra: Partial<CraftOffer> = {}): CraftOffer {
  return {
    code: to,
    groupCode: 'farmSeeds',
    craftingTimeSeconds: 0,
    recipes: [
      {
        code: to,
        isDefault: true,
        requiredItems: [{ itemType: 'farmSeed', code: from, count }],
        resultGroups: [{ code: `${to}_ok`, items: [{ itemType: 'farmSeed', code: to, count: 1 }] }],
      },
    ],
    ...extra,
  }
}

const seed = (code: string, count: number): InventoryItem => ({
  itemType: 'farmSeed',
  code,
  rarity: null,
  name: code,
  count,
})

function inventory(items: InventoryItem[], crafting: CraftOffer[], overrides: Partial<Inventory> = {}): Inventory {
  return {
    ...emptyInventory,
    items,
    crafting: [feedOffer, ...crafting],
    gardens: [
      {
        code: 'free_garden',
        landId: 'sunny-field',
        width: 4,
        height: 4,
        devices: [],
        beds: [
          {
            id: 'cow',
            rarity: 'common',
            kind: 'cattle',
            isAnimal: true,
            tiles: [{ x: 0, y: 0 }],
            lamp: null,
            unmodelledLamp: null,
            plantedSeedCode: null,
          },
        ],
      },
    ],
    ...overrides,
  }
}

function planUsing(seedId: string, rarity: 'common' | 'uncommon', beds: number, renewable = true): Plan {
  return {
    horizonSec: 86_400,
    bucketSec: 60,
    totalBiopoints: 0,
    totalLucky: 0,
    totalPlain: 0,
    biopointsPerHour: 0,
    biopointsPerPoolCycle: 0,
    totalPlots: beds,
    warnings: [],
    plots: [
      {
        groupId: 'g',
        plotRarity: 'rare',
        landId: 'sunny-field',
        lamp: null,
        plots: beds,
        entries: [
          {
            seedId,
            seedName: seedId,
            seedType: 'x',
            rarity,
            plantings: 3,
            growthSec: 3600,
            biopointsEach: 1,
            biopointsTotal: 3,
            biopointsLuckyTotal: 3,
            biopointsPlainTotal: 3,
            renewable,
          },
        ],
        biopointsPerPlot: 3,
        biopoints: 3,
        biopointsLucky: 3,
        biopointsPlain: 3,
        usedSec: 0,
        idleSec: 0,
      },
    ],
  }
}

describe('buildSeedAdvice', () => {
  it('never merges the last seed a feed needs', () => {
    // Two common peas: merging them would end common cattle food for good.
    const advice = buildSeedAdvice(
      inventory([seed('common_peas_seeds', 2), seed('common_corn_seeds', 1)], [merge('common_peas_seeds', 'uncommon_peas_seeds')]),
      catalogue(),
      null,
      NOW,
    )
    expect(advice.merges).toEqual([])
    const peas = advice.keep.find((holding) => holding.code === 'common_peas_seeds')
    expect(peas?.keep).toBe(1)
    expect(peas?.reasons).toContain('Common Cattle Food')
  })

  it('merges only the surplus, with the recipe counts the game sent', () => {
    const advice = buildSeedAdvice(
      inventory([seed('common_peas_seeds', 8), seed('common_corn_seeds', 1)], [merge('common_peas_seeds', 'uncommon_peas_seeds', 3)]),
      catalogue(),
      null,
      NOW,
    )
    // 8 held, 1 kept for the feed: 7 spare, 3 per merge -> 2 merges, 1 left.
    expect(advice.merges).toHaveLength(1)
    expect(advice.merges[0]?.times).toBe(2)
    expect(advice.merges[0]?.inputs[0]).toMatchObject({ code: 'common_peas_seeds', count: 3 })
    expect(advice.merges[0]?.output).toMatchObject({ code: 'uncommon_peas_seeds', rarity: 'uncommon' })
  })

  it('keeps one seed per bed the plan plants it in, plus one for the feed', () => {
    const advice = buildSeedAdvice(
      inventory([seed('common_peas_seeds', 5), seed('common_corn_seeds', 1)], [merge('common_peas_seeds', 'uncommon_peas_seeds')]),
      catalogue(),
      planUsing('peas-seed', 'common', 3),
      NOW,
    )
    const peas = advice.keep.find((holding) => holding.code === 'common_peas_seeds')
    expect(peas?.keep).toBe(4)
    expect(peas?.reasons[0]).toBe('planted in 3 beds')
    expect(advice.merges).toEqual([])
  })

  it('names a missing seed and fills it from surplus through a captured recipe', () => {
    // No common corn at all. A recipe that makes it from beet stands in for any captured merge
    // whose inputs the player holds in surplus.
    const advice = buildSeedAdvice(
      inventory(
        [seed('common_peas_seeds', 1), seed('common_beet_seeds', 4)],
        [merge('common_beet_seeds', 'common_corn_seeds')],
      ),
      catalogue(),
      null,
      NOW,
    )
    expect(advice.missing).toHaveLength(1)
    const gap = advice.missing[0]!
    expect(gap.code).toBe('common_corn_seeds')
    expect(gap.unlocks).toEqual(['Common Cattle Food'])
    expect(gap.blocking).toBe(true)
    expect(gap.fix.kind).toBe('merge')
    // Filling the gap spent 2 of the 4 beet; the 2 left over merge once more, not twice.
    expect(advice.merges[0]?.times).toBe(1)
  })

  it('says how far short the surplus is when a recipe exists', () => {
    const advice = buildSeedAdvice(
      inventory([seed('common_peas_seeds', 1), seed('common_beet_seeds', 1)], [merge('common_beet_seeds', 'common_corn_seeds')]),
      catalogue(),
      null,
      NOW,
    )
    const fix = advice.missing[0]?.fix
    expect(fix?.kind).toBe('short')
    if (fix?.kind === 'short') expect(fix.have[0]).toMatchObject({ code: 'common_beet_seeds', spare: 1, count: 2 })
  })

  it('sends the player to obtain a seed no captured recipe makes', () => {
    const advice = buildSeedAdvice(inventory([seed('common_peas_seeds', 1)], []), catalogue(), null, NOW)
    expect(advice.missing[0]?.fix.kind).toBe('obtain')
    expect(advice.hasMergeRecipes).toBe(false)
  })

  it('ignores an expired event recipe and a recipe that rolls', () => {
    const expired = merge('common_peas_seeds', 'uncommon_peas_seeds', 2, { dateTo: '2026-11-01T00:00:00Z' })
    const roll = merge('common_corn_seeds', 'uncommon_corn_seeds')
    roll.recipes[0]!.resultGroups.push({ code: 'fail', items: [{ itemType: 'farmSeed', code: 'common_corn_seeds', count: 1 }] })

    const advice = buildSeedAdvice(
      inventory([seed('common_peas_seeds', 9), seed('common_corn_seeds', 9)], [expired, roll]),
      catalogue(),
      null,
      NOW,
    )
    expect(advice.merges).toEqual([])
    expect(advice.hasMergeRecipes).toBe(false)
  })

  it('names the currency a merge costs and reports recipe coverage', () => {
    const priced = merge('common_peas_seeds', 'uncommon_peas_seeds', 2, { price: { currency: 'CFB', amount: 5000 } })
    const advice = buildSeedAdvice(
      inventory([seed('common_peas_seeds', 5), seed('common_corn_seeds', 1)], [priced], { craftingTotal: 378 }),
      catalogue(),
      null,
      NOW,
    )
    expect(advice.merges[0]?.currency).toBe('CFB')
    expect(advice.recipesKnown).toBe(2)
    expect(advice.recipesTotal).toBe(378)
  })
})
