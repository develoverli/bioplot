import { describe, expect, it } from 'vitest'
import { buildFeedReport } from './feed'
import { emptyInventory } from './inventory'
import { emptyCatalogue, type Catalogue, type Garden, type Inventory } from './types'

function garden(): Garden {
  return {
    code: 'free_garden',
    landId: 'sunny-field',
    width: 10,
    height: 10,
    devices: [],
    beds: [
      {
        id: 'cow',
        rarity: 'common',
        kind: 'cattle',
        isAnimal: true,
        tiles: [{ x: 0, y: 0 }],
        lamp: null,
        plantedSeedCode: null,
      },
    ],
  }
}

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
      {
        code: 'epic_cattle_food',
        rarity: 'epic',
        name: 'cattle_food',
        biopoints: null,
        growthSec: 21_600,
        image: null,
      },
      {
        code: 'common_cattle_food',
        rarity: 'common',
        name: 'cattle_food',
        biopoints: null,
        growthSec: 21_600,
        image: null,
      },
    ],
    vegetables: [
      { code: 'epic_milk', rarity: 'epic', name: 'milk', biopoints: 1000, growthSec: null, image: null },
      { code: 'common_milk', rarity: 'common', name: 'milk', biopoints: 10, growthSec: null, image: null },
    ],
  }
}

/** One recipe: 2 common corn make 1 common cattle food. */
function inventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    ...emptyInventory,
    gardens: [garden()],
    crafting: [
      {
        code: 'common_cattle_food',
        groupCode: 'farmPetFood',
        craftingTimeSeconds: 0,
        recipes: [
          {
            code: 'common_cattle_food',
            isDefault: true,
            requiredItems: [{ itemType: 'farmVegetables', code: 'common_corn', count: 2 }],
            resultGroups: [
              {
                code: 'ok',
                items: [{ itemType: 'farmSeeds', code: 'common_cattle_food', count: 1 }],
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe('buildFeedReport', () => {
  it('finds the feed that fits an animal by its type', () => {
    const report = buildFeedReport(inventory(), catalogue())
    const cow = report.animals[0]!

    expect(cow.name).toBe('Common Cattle')
    // Strongest first, both cattle feeds, nothing from other animals.
    expect(cow.feeds.map((feed) => feed.code)).toEqual(['epic_cattle_food', 'common_cattle_food'])
  })

  it('counts what the harvest could craft, not just what is held', () => {
    const report = buildFeedReport(
      inventory({
        items: [
          { itemType: 'farmVegetables', code: 'common_corn', rarity: 'common', name: 'corn', count: 7 },
        ],
      }),
      catalogue(),
    )
    const cow = report.animals[0]!

    // 7 corn at 2 per craft is 3 feeds, and none are in the bag yet.
    expect(cow.best).toBeNull()
    expect(cow.obtainable?.code).toBe('common_cattle_food')
    expect(cow.obtainable?.craftable).toBe(3)
  })

  it('prefers feed on hand over feed you would have to craft', () => {
    const report = buildFeedReport(
      inventory({
        items: [
          { itemType: 'farmSeeds', code: 'epic_cattle_food', rarity: 'epic', name: 'cattle_food', count: 1 },
        ],
      }),
      catalogue(),
    )
    expect(report.animals[0]!.best?.code).toBe('epic_cattle_food')
  })

  it('values the pen from the produce its bed accepts', () => {
    const report = buildFeedReport(
      inventory({
        items: [
          { itemType: 'farmSeeds', code: 'epic_cattle_food', rarity: 'epic', name: 'cattle_food', count: 1 },
        ],
      }),
      catalogue(),
    )
    const output = report.animals[0]!.output!

    // Epic feed is assumed to make epic milk: 86400 / 21600 = 4 feedings a day.
    expect(output.productCode).toBe('epic_milk')
    expect(output.cycles).toBe(4)
    expect(output.biopointsPerDay).toBe(4000)
    expect(report.biopointsPerDay).toBe(4000)
  })

  it('says nothing rather than guessing when no produce is known', () => {
    const report = buildFeedReport(inventory(), { ...emptyCatalogue, beds: catalogue().beds })
    expect(report.hasOutput).toBe(false)
    expect(report.biopointsPerDay).toBe(0)
  })
})

describe('what to feed', () => {
  const item = (code: string, count: number) => ({
    itemType: 'farmVegetables',
    code,
    rarity: null,
    name: code,
    count,
  })

  it('recommends the feed you can keep making, not the one you merely hold', () => {
    const report = buildFeedReport(
      inventory({
        items: [item('common_corn_seeds', 1), item('epic_cattle_food', 3)],
      }),
      catalogue(),
    )
    const cow = report.animals[0]!
    expect(cow.recommended?.code).toBe('common_cattle_food')
    expect(cow.recommended?.sustainable).toBe(true)
    // The epic feed is stock from somewhere else: usable, never a plan.
    expect(cow.stockOnly?.code).toBe('epic_cattle_food')
    expect(cow.ideal?.productCode).toBe('common_milk')
  })

  it('names the closest recipe and exactly what it is short of when nothing can be made', () => {
    const report = buildFeedReport(inventory({ items: [item('common_corn', 1)] }), catalogue())
    const cow = report.animals[0]!
    expect(cow.recommended).toBeNull()
    expect(cow.nearest?.feed.code).toBe('common_cattle_food')
    expect(cow.nearest?.short).toEqual([
      expect.objectContaining({ code: 'common_corn', count: 2, owned: 1, hasSeed: false }),
    ])
  })

  it('takes a craftable-now feed over none, and says it will not last', () => {
    const report = buildFeedReport(inventory({ items: [item('common_corn', 4)] }), catalogue())
    const cow = report.animals[0]!
    expect(cow.recommended?.code).toBe('common_cattle_food')
    expect(cow.recommended?.sustainable).toBe(false)
    expect(cow.recommended?.craftable).toBe(2)
    expect(cow.recommended?.cannotGrow).toEqual(['Common Corn'])
  })
})
