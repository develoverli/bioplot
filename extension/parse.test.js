import { describe, expect, it } from 'vitest'
import './src/seed-names.js'
import './src/parse.js'

const {
  classify,
  collect,
  expand,
  readBedTypes,
  readGardenLayout,
  readGardens,
  readInventory,
  splitItemCode,
  toPayload,
} = globalThis.BioplotParse

describe('classify', () => {
  it('recognises a seed row by its name', () => {
    expect(classify({ name: 'Corn Seed', rarity: 'Epic', count: 4 })).toEqual({
      kind: 'seed',
      seedId: 'corn-seed',
      name: 'Corn Seed',
      rarity: 'epic',
      count: 4,
    })
  })

  it('accepts alternative key spellings', () => {
    expect(classify({ title: 'basil', quality: 'RARE', amount: 2 })).toMatchObject({
      kind: 'seed',
      seedId: 'basil-seed',
      rarity: 'rare',
      count: 2,
    })
  })

  it('refuses a numeric rarity instead of guessing 0- or 1-based', () => {
    expect(classify({ name: 'Corn Seed', rarity: 4, count: 1 })).toBeNull()
  })

  it('recognises a plot row', () => {
    expect(classify({ name: 'Garden bed', rarity: 'legendary', count: 3 })).toEqual({
      kind: 'plot',
      rarity: 'legendary',
      count: 3,
    })
  })

  it('ignores rows without a rarity', () => {
    expect(classify({ name: 'Corn Seed', count: 4 })).toBeNull()
    expect(classify({ rarity: 'epic', count: 0 })).toBeNull()
  })

  it('ignores things that are not objects', () => {
    expect(classify(null)).toBeNull()
    expect(classify(['corn'])).toBeNull()
    expect(classify('corn')).toBeNull()
  })
})

describe('collect', () => {
  it('finds rows nested anywhere in the payload', () => {
    const found = collect({
      success: true,
      data: {
        inventory: {
          items: [
            { name: 'Corn Seed', rarity: 'common', count: 12 },
            { name: 'Tomato Seed', rarity: 'legendary', count: 2 },
          ],
          beds: [{ name: 'Plot', rarity: 'rare', count: 8 }],
        },
      },
    })

    expect(found.seeds).toHaveLength(2)
    expect(found.plots).toEqual([{ rarity: 'rare', count: 8 }])
  })

  it('survives payloads with nothing useful in them', () => {
    expect(collect({ hello: 'world', list: [1, 2, 3] })).toEqual({ seeds: [], plots: [] })
  })
})

describe('expand', () => {
  it('parses JSON that arrives as a string', () => {
    // The socket sends {command, value} where value is itself JSON text.
    expect(expand({ command: 'x', value: '{"a":1}' })).toEqual({ command: 'x', value: { a: 1 } })
  })

  it('leaves ordinary strings alone', () => {
    expect(expand({ name: 'Corn Seed', note: 'not json' })).toEqual({
      name: 'Corn Seed',
      note: 'not json',
    })
  })

  it('leaves malformed JSON as text', () => {
    expect(expand({ value: '{broken' })).toEqual({ value: '{broken' })
  })
})

describe('collect through a socket frame', () => {
  it('finds rows inside a double-encoded value', () => {
    const frame = {
      command: 'seeds-list',
      value: JSON.stringify({ items: [{ name: 'Corn Seed', rarity: 'epic', count: 5 }] }),
    }
    expect(collect(frame).seeds).toEqual([
      { seedId: 'corn-seed', name: 'Corn Seed', rarity: 'epic', count: 5 },
    ])
  })
})

describe('toPayload', () => {
  it('builds an import payload the web app accepts', () => {
    const payload = toPayload([
      {
        url: 'https://chainers.io/api/farm/inventory',
        at: 1,
        body: JSON.stringify({ items: [{ name: 'Corn Seed', rarity: 'common', count: 3 }] }),
      },
    ])

    expect(payload.version).toBe(1)
    expect(payload.source).toBe('bioplot-extension')
    expect(payload.seeds).toEqual([
      { seedId: 'corn-seed', name: 'Corn Seed', rarity: 'common', count: 3 },
    ])
  })

  it('lets a newer capture replace an older one', () => {
    const body = (count) =>
      JSON.stringify({ items: [{ name: 'Corn Seed', rarity: 'common', count }] })

    const payload = toPayload([
      { url: 'a', at: 1, body: body(3) },
      { url: 'a', at: 2, body: body(9) },
    ])

    expect(payload.seeds).toHaveLength(1)
    expect(payload.seeds[0].count).toBe(9)
  })

  it('skips captures that are not JSON', () => {
    expect(toPayload([{ url: 'a', at: 1, body: '<html>nope</html>' }]).seeds).toEqual([])
  })
})

describe('splitItemCode', () => {
  it('reads the rarity out of the code prefix', () => {
    expect(splitItemCode('legendary_vegetable_plot')).toEqual({
      rarity: 'legendary',
      rest: 'vegetable_plot',
    })
    expect(splitItemCode('epic_purple_carrot')).toEqual({ rarity: 'epic', rest: 'purple_carrot' })
  })

  it('reports no rarity when the prefix is not one', () => {
    expect(splitItemCode('cropper')).toEqual({ rarity: undefined, rest: 'cropper' })
  })
})

describe('readInventory', () => {
  const payload = {
    success: true,
    data: {
      items: [
        { inventoryType: 'active', itemType: 'farmFertilizers', itemCode: 'common_fertilizer', count: 41 },
        { inventoryType: 'active', itemType: 'farmSeeds', itemCode: 'legendary_corn', count: 7 },
        { inventoryType: 'active', itemType: 'farmSeeds', itemCode: 'epic_bird_food', count: 3 },
        { inventoryType: 'active', itemType: 'farmBeds', itemCode: 'rare_vegetable_plot', count: 4 },
        { inventoryType: 'stored', itemType: 'farmSeeds', itemCode: 'rare_corn', count: 99 },
      ],
    },
  }

  it('maps seed codes onto the catalogue', () => {
    const { seeds } = readInventory(payload)
    expect(seeds).toContainEqual({ seedId: 'corn-seed', name: 'corn', rarity: 'legendary', count: 7 })
  })

  it('keeps unknown seeds so they can be reported, not silently dropped', () => {
    const { seeds } = readInventory(payload)
    expect(seeds).toContainEqual({ seedId: undefined, name: 'bird_food', rarity: 'epic', count: 3 })
  })

  it('ignores fertilizers and anything not currently active', () => {
    const { seeds, spareBeds } = readInventory(payload)
    expect(seeds.some((seed) => seed.name === 'fertilizer')).toBe(false)
    expect(seeds.some((seed) => seed.count === 99)).toBe(false)
    expect(spareBeds).toEqual([{ rarity: 'rare', count: 4 }])
  })
})

describe('readGardens', () => {
  const garden = {
    data: [
      {
        code: 'free_garden',
        placedDevices: [
          {
            itemCode: 'uncommon_lamp_device',
            coveredCoordinates: [{ x: 2, y: 17 }, { x: 0, y: 18 }],
          },
        ],
        placedBeds: [
          { itemCode: 'legendary_vegetable_plot', placementCoordinates: [{ x: 0, y: 18 }] },
          { itemCode: 'legendary_vegetable_plot', placementCoordinates: [{ x: 9, y: 9 }] },
          { itemCode: 'common_vegetable_plot', placementCoordinates: [{ x: 5, y: 5 }] },
        ],
      },
    ],
  }

  it('groups beds by rarity and by the lamp actually covering them', () => {
    expect(readGardens(garden)).toEqual([
      { rarity: 'legendary', landId: 'sunny-field', lamp: 'uncommon', count: 1 },
      { rarity: 'legendary', landId: 'sunny-field', lamp: null, count: 1 },
      { rarity: 'common', landId: 'sunny-field', lamp: null, count: 1 },
    ])
  })

  it('keeps animal pens, which the game also models as beds', () => {
    // /api/farm/control/plant-seed answers with farmBedsCode "common_cattle": an animal is a
    // bed you plant feed into. Filtering on "plot" or "bed" used to drop every one of them.
    const withAnimals = {
      data: [
        {
          code: 'free_garden',
          placedBeds: [
            { userBedsID: 'p1', itemCode: 'legendary_vegetable_plot', placementCoordinates: [{ x: 0, y: 0 }] },
            {
              userBedsID: 'a1',
              itemCode: 'common_cattle',
              placementCoordinates: [{ x: 4, y: 4 }],
              plantedSeed: { seedCode: 'epic_cattle_food' },
            },
          ],
        },
      ],
    }

    const beds = readGardenLayout(withAnimals)[0].beds
    expect(beds).toHaveLength(2)
    expect(beds.find((bed) => bed.id === 'a1')).toMatchObject({
      kind: 'cattle',
      isAnimal: true,
      plantedSeedCode: 'epic_cattle_food',
    })
    expect(beds.find((bed) => bed.id === 'p1')?.isAnimal).toBe(false)

    // Crop planning still only sees soil.
    expect(readGardens(withAnimals)).toEqual([
      { rarity: 'legendary', landId: 'sunny-field', lamp: null, count: 1 },
    ])
  })

  it('survives a garden with nothing placed in it', () => {
    expect(readGardens({ data: [{ code: 'free_garden' }] })).toEqual([])
  })
})

describe('toPayload with real endpoints', () => {
  it('prefers the placed layout over spare beds in the inventory', () => {
    const captures = [
      {
        url: 'https://chainers.io/api/farm/user/inventory',
        at: 1,
        body: JSON.stringify({
          data: {
            items: [
              { inventoryType: 'active', itemType: 'farmBeds', itemCode: 'rare_vegetable_plot', count: 4 },
            ],
          },
        }),
      },
      {
        url: 'https://chainers.io/api/farm/user/gardens',
        at: 2,
        body: JSON.stringify({
          data: [
            {
              code: 'free_garden',
              placedBeds: [
                { itemCode: 'epic_vegetable_plot', placementCoordinates: [{ x: 1, y: 1 }] },
              ],
            },
          ],
        }),
      },
    ]

    expect(toPayload(captures).plots).toEqual([
      { rarity: 'epic', landId: 'sunny-field', lamp: null, count: 1 },
    ])
  })

  it('falls back to spare beds when the layout was never captured', () => {
    const captures = [
      {
        url: 'https://chainers.io/api/farm/user/inventory',
        at: 1,
        body: JSON.stringify({
          data: {
            items: [
              { inventoryType: 'active', itemType: 'farmBeds', itemCode: 'rare_vegetable_plot', count: 4 },
            ],
          },
        }),
      },
    ]

    expect(toPayload(captures).plots).toEqual([{ rarity: 'rare', count: 4 }])
  })
})

describe('rarity from a name', () => {
  const bedTypes = (code, label) =>
    readBedTypes({
      data: { items: [{ code, rarity: { code: label }, type: {}, farmMedia: {} }] },
    })[0]

  it('never mistakes uncommon for common', () => {
    // "uncommon".includes("common") is true, which recorded every uncommon item one tier low.
    expect(bedTypes('uncommon_cattle', 'UNCOMMON').rarity).toBe('uncommon')
    expect(bedTypes('common_cattle', 'COMMON').rarity).toBe('common')
  })

  it('still reads a rarity out of a longer label', () => {
    expect(bedTypes('epic_cattle', 'Epic Rarity').rarity).toBe('epic')
    expect(bedTypes('uncommon_cattle', 'rarity: uncommon').rarity).toBe('uncommon')
  })

  it('falls back to the code prefix when the label says nothing', () => {
    expect(bedTypes('uncommon_cattle', 'tier-2').rarity).toBe('uncommon')
  })
})
