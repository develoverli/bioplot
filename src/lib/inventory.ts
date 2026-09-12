import { z } from 'zod'
import { defaultLandId, getSeed, lands, seeds } from './catalog'
import {
  LAMP_RARITIES,
  RARITIES,
  emptyCatalogue,
  emptyPools,
  type Catalogue,
  type Garden,
  type Inventory,
  type PlotGroup,
  type Rarity,
} from './types'

export const raritySchema = z.enum(RARITIES)
export const lampSchema = z.enum(LAMP_RARITIES)

export const seedStackSchema = z.object({
  seedId: z.string().min(1),
  rarity: raritySchema,
  count: z.number().int().min(0).max(1_000_000),
})

export const plotGroupSchema = z.object({
  id: z.string().min(1),
  rarity: raritySchema,
  landId: z.string().min(1),
  lamp: lampSchema.nullable(),
  count: z.number().int().min(0).max(10_000),
})

const tileSchema = z.object({ x: z.number().int(), y: z.number().int() })

export const gardenSchema = z.object({
  code: z.string(),
  landId: z.string(),
  width: z.number().int().min(1).max(200),
  height: z.number().int().min(1).max(200),
  beds: z.array(
    z.object({
      id: z.string(),
      rarity: raritySchema,
      kind: z.string(),
      isAnimal: z.boolean().default(false),
      tiles: z.array(tileSchema),
      lamp: lampSchema.nullable(),
      plantedSeedCode: z.string().nullable(),
    }),
  ),
  devices: z.array(
    z.object({
      id: z.string(),
      code: z.string().default(''),
      rarity: lampSchema,
      tiles: z.array(tileSchema),
      covered: z.array(tileSchema),
    }),
  ),
})

const catalogueEntrySchema = z.object({
  code: z.string(),
  rarity: raritySchema,
  name: z.string(),
  biopoints: z.number().nullable(),
  growthSec: z.number().nullable(),
  image: z.string().nullable(),
})

const catalogueBedSchema = z.object({
  code: z.string(),
  rarity: raritySchema.nullable(),
  groupCode: z.string(),
  typeCode: z.string(),
  growthTimeModifier: z.number(),
  compatible: z.array(z.string()),
  image: z.string().nullable(),
})

export const catalogueSchema = z.object({
  vegetables: z.array(catalogueEntrySchema).default([]),
  seeds: z.array(catalogueEntrySchema).default([]),
  beds: z.array(catalogueBedSchema).default([]),
  devices: z.array(catalogueBedSchema).default([]),
})

const inventoryItemSchema = z.object({
  itemType: z.string(),
  code: z.string(),
  rarity: raritySchema.nullable(),
  name: z.string(),
  count: z.number().min(0),
})

const craftItemSchema = z.object({
  itemType: z.string(),
  code: z.string(),
  count: z.number().min(0),
})

const craftOfferSchema = z.object({
  code: z.string(),
  groupCode: z.string(),
  craftingTimeSeconds: z.number().min(0),
  recipes: z.array(
    z.object({
      code: z.string(),
      isDefault: z.boolean(),
      requiredItems: z.array(craftItemSchema),
      resultGroups: z.array(z.object({ code: z.string(), items: z.array(craftItemSchema) })),
    }),
  ),
})

const poolsSchema = z.object({
  blocks: z
    .array(
      z.object({
        code: z.string(),
        groupCode: z.string(),
        currency: z.string(),
        payout: z.number(),
        totalWeight: z.number(),
        userWeight: z.number(),
        startDate: z.string(),
        endDate: z.string(),
        explorerURL: z.string(),
      }),
    )
    .default([]),
  groups: z
    .array(
      z.object({
        groupCode: z.string(),
        title: z.string(),
        currency: z.string(),
        icon: z.string().nullable(),
        blockTimeSeconds: z.number(),
      }),
    )
    .default([]),
  level: z
    .object({
      code: z.string(),
      level: z.number(),
      points: z.number(),
      visualMaxPoints: z.number(),
      icon: z.string().nullable(),
    })
    .nullable()
    .default(null),
  levels: z
    .array(
      z.object({
        code: z.string(),
        level: z.number(),
        pointsToClaim: z.number(),
        icon: z.string().nullable(),
      }),
    )
    .default([]),
  payouts: z
    .array(
      z.object({
        code: z.string(),
        currency: z.string(),
        amount: z.number(),
        totalWeight: z.number(),
        userWeight: z.number(),
        created: z.string(),
        explorerTxURL: z.string(),
      }),
    )
    .default([]),
})

export const inventorySchema = z.object({
  seeds: z.array(seedStackSchema),
  plots: z.array(plotGroupSchema),
  gardens: z.array(gardenSchema).default([]),
  items: z.array(inventoryItemSchema).default([]),
  crafting: z.array(craftOfferSchema).default([]),
  pools: poolsSchema.default(emptyPools),
})

/**
 * What the browser extension hands over. The game's own payload shape is undocumented,
 * so the extension normalises to this and always attaches what it saw under `raw`.
 */
export const importPayloadSchema = z.object({
  version: z.literal(1),
  source: z.string(),
  capturedAt: z.string().optional(),
  seeds: z
    .array(
      z.object({
        seedId: z.string().optional(),
        name: z.string().optional(),
        rarity: z.string(),
        count: z.number().min(0),
      }),
    )
    .default([]),
  plots: z
    .array(
      z.object({
        rarity: z.string(),
        landId: z.string().optional(),
        lamp: z.string().nullish(),
        count: z.number().min(0),
      }),
    )
    .default([]),
  // Present when the real layout was captured; drives the farm map.
  gardens: z.array(gardenSchema).default([]),
  // The game's own numbers and art, when the catalogues were captured.
  catalogue: catalogueSchema.default(emptyCatalogue),
  items: z.array(inventoryItemSchema).default([]),
  crafting: z.array(craftOfferSchema).default([]),
  pools: poolsSchema.default(emptyPools),
  raw: z.unknown().optional(),
})

export type ImportPayload = z.infer<typeof importPayloadSchema>

export interface ImportResult {
  inventory: Inventory
  catalogue: Catalogue
  matched: number
  unmatched: string[]
}

function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// Built once: the import path can run over hundreds of rows.
const seedIdByName = new Map<string, string>()
for (const seed of seeds) {
  seedIdByName.set(normaliseName(seed.name), seed.id)
  seedIdByName.set(normaliseName(seed.id), seed.id)
  // "Corn Seed" should also answer to "corn".
  seedIdByName.set(normaliseName(seed.name.replace(/\s*seeds?$/i, '')), seed.id)
}

export function matchSeedId(value: string | undefined): string | undefined {
  if (!value) return undefined
  const key = normaliseName(value)
  return seedIdByName.get(key) ?? seedIdByName.get(key.replace(/seeds?$/, ''))
}

function matchRarity(value: string): Rarity | undefined {
  const key = value.toLowerCase().trim()
  return (RARITIES as readonly string[]).includes(key) ? (key as Rarity) : undefined
}

const landIds = new Set(lands.map((land) => land.id))

/** Turns an extension capture into an inventory this app can plan with. */
export function fromImportPayload(payload: ImportPayload): ImportResult {
  const stacks = new Map<string, number>()
  const unmatched: string[] = []
  let matched = 0

  for (const row of payload.seeds) {
    const seedId = row.seedId && getSeed(row.seedId) ? row.seedId : matchSeedId(row.name)
    const rarity = matchRarity(row.rarity)
    if (!seedId || !rarity) {
      unmatched.push(row.name ?? row.seedId ?? 'unknown seed')
      continue
    }
    matched += 1
    const key = `${seedId}|${rarity}`
    stacks.set(key, (stacks.get(key) ?? 0) + Math.floor(row.count))
  }

  const plotGroups = new Map<string, number>()
  for (const row of payload.plots) {
    const rarity = matchRarity(row.rarity)
    if (!rarity) {
      unmatched.push(`plot ${row.rarity}`)
      continue
    }
    matched += 1
    const landId = row.landId && landIds.has(row.landId) ? row.landId : defaultLandId
    const lamp = row.lamp && (LAMP_RARITIES as readonly string[]).includes(row.lamp) ? row.lamp : null
    const key = `${rarity}|${landId}|${lamp ?? 'none'}`
    plotGroups.set(key, (plotGroups.get(key) ?? 0) + Math.floor(row.count))
  }

  const gardens: Garden[] = (payload.gardens ?? []).map((garden) => ({
    ...garden,
    landId: landIds.has(garden.landId) ? garden.landId : defaultLandId,
  }))

  // The layout, when present, is the better source: it knows which lamp covers which bed.
  const plots = gardens.length > 0 ? plotsFromGardens(gardens) : undefined
  if (gardens.length > 0) matched += gardens.reduce((sum, g) => sum + g.beds.length, 0)

  return {
    matched,
    unmatched: [...new Set(unmatched)],
    catalogue: payload.catalogue ?? emptyCatalogue,
    inventory: {
      gardens,
      items: payload.items ?? [],
      crafting: payload.crafting ?? [],
      pools: payload.pools ?? emptyPools,
      seeds: [...stacks].map(([key, count]) => {
        const [seedId, rarity] = key.split('|') as [string, Rarity]
        return { seedId, rarity, count }
      }),
      plots:
        plots ??
        [...plotGroups].map(([key, count], index) => {
          const [rarity, landId, lamp] = key.split('|') as [Rarity, string, string]
          return {
            id: `imported-${index}`,
            rarity,
            landId,
            lamp: lamp === 'none' ? null : (lamp as (typeof LAMP_RARITIES)[number]),
            count,
          }
        }),
    },
  }
}

export const emptyInventory: Inventory = {
  seeds: [],
  plots: [],
  gardens: [],
  items: [],
  crafting: [],
  pools: emptyPools,
}

/** A first-run farm so the app is never a blank page. */
export function starterInventory(): Inventory {
  return {
    seeds: [],
    plots: [{ id: 'starter', rarity: 'common', landId: defaultLandId, lamp: null, count: 6 }],
    gardens: [],
    items: [],
    crafting: [],
    pools: emptyPools,
  }
}

/**
 * When the real layout is known, each bed becomes its own plot group.
 *
 * The planner then produces one schedule per bed rather than per group, which is what the
 * farm map needs to say "plant this, here".
 */
export function plotsFromGardens(gardens: Garden[]): PlotGroup[] {
  return gardens.flatMap((garden) =>
    // Animals take feed, not seeds, so they are not crop plots.
    garden.beds
      .filter((bed) => !bed.isAnimal)
      .map((bed) => ({
        id: bed.id,
        rarity: bed.rarity,
        landId: garden.landId,
        lamp: bed.lamp,
        count: 1,
      })),
  )
}
