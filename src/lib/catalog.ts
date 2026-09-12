import gameJson from '../../data/game.json'
import seedsJson from '../../data/seeds.json'
import type {
  GameData,
  LampRarity,
  LampSpec,
  LandSpec,
  PlotSpec,
  Rarity,
  Seed,
  SeedsData,
} from './types'
import { RARITIES } from './types'

export const game = gameJson as unknown as GameData
export const seedsData = seedsJson as unknown as SeedsData
export const seeds: Seed[] = seedsData.seeds

// O(1) lookups instead of scanning the arrays on every render/iteration.
const seedById = new Map(seeds.map((seed) => [seed.id, seed]))
const plotByRarity = new Map(game.plots.map((plot) => [plot.rarity, plot]))
const lampByRarity = new Map(game.lamps.map((lamp) => [lamp.rarity, lamp]))
const landById = new Map(game.lands.map((land) => [land.id, land]))

export function getSeed(id: string): Seed | undefined {
  return seedById.get(id)
}

export function getPlotSpec(rarity: Rarity): PlotSpec {
  const spec = plotByRarity.get(rarity)
  if (!spec) throw new Error(`Unknown plot rarity: ${rarity}`)
  return spec
}

export function getLampSpec(rarity: LampRarity | null): LampSpec | null {
  if (rarity === null) return null
  const spec = lampByRarity.get(rarity)
  if (!spec) throw new Error(`Unknown lamp rarity: ${rarity}`)
  return spec
}

export function getLand(id: string): LandSpec {
  const land = landById.get(id)
  if (!land) throw new Error(`Unknown land: ${id}`)
  return land
}

export const lands = game.lands
export const defaultLandId = game.lands[0]?.id ?? 'sunny-field'

/** The rarity one tier above `rarity`, or null at the top of the scale. */
export function nextRarity(rarity: Rarity): Rarity | null {
  const index = RARITIES.indexOf(rarity)
  return RARITIES[index + 1] ?? null
}
