export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const
export type Rarity = (typeof RARITIES)[number]

export const LAMP_RARITIES = ['common', 'uncommon', 'rare'] as const
export type LampRarity = (typeof LAMP_RARITIES)[number]

export type Medium = 'soil' | 'water'

export interface SeedVariant {
  biopoints: number
  growthSec: number
}

export interface Seed {
  id: string
  name: string
  /** Docs family: Basic, Disposable, Limited, Seasonal, ... */
  type: string
  medium: Medium
  /** Disposable seeds are consumed on harvest; everything else comes back. */
  renewable: boolean
  variants: Partial<Record<Rarity, SeedVariant>>
}

export interface PlotSpec {
  rarity: Rarity
  criticalChance: number
  normalDrop: number
  criticalDrop: number
}

export interface LampSpec {
  rarity: LampRarity
  growthTimeReduction: number
  rarityUpgradeChance: number
  criticalMultiplier: number
}

export interface LandSpec {
  id: string
  name: string
  medium: Medium
  productionMultiplier: number
  size: string | null
}

export interface RewardPoolSpec {
  cycleHours: number
  cyclesPerDay: number
  currencies: string[]
  tiers: number
  withdrawalLimits: Record<string, number>
}

export interface GameData {
  source: string
  extractedAt: string
  rarities: Rarity[]
  plots: PlotSpec[]
  lamps: LampSpec[]
  lands: LandSpec[]
  fertilizers: { rarity: Rarity; growthTimeReduction: number; note: string }[]
  rewardPool: RewardPoolSpec
  notes: string[]
}

export interface SeedsData {
  source: string
  extractedAt: string
  seeds: Seed[]
}

/** One row of the player's seed inventory. */
export interface SeedStack {
  seedId: string
  rarity: Rarity
  /** How many the player owns. Ignored for renewable seeds (they never run out). */
  count: number
}

/** A group of identical plots sitting on the same land under the same lamp. */
export interface PlotGroup {
  id: string
  rarity: Rarity
  landId: string
  lamp: LampRarity | null
  count: number
}

export interface Tile {
  x: number
  y: number
}

/** One bed as it actually sits on the land, with the tiles it covers. */
export interface GardenBed {
  id: string
  rarity: Rarity
  kind: string
  /** An animal pen rather than soil: it takes feed, not crops. */
  isAnimal: boolean
  tiles: Tile[]
  lamp: LampRarity | null
  plantedSeedCode: string | null
}

export interface GardenDevice {
  id: string
  /** The item code, e.g. "uncommon_lamp_device", for looking up its art. */
  code: string
  rarity: LampRarity
  tiles: Tile[]
  covered: Tile[]
}

/** A whole plot of land with everything placed on it. */
export interface Garden {
  code: string
  landId: string
  width: number
  height: number
  beds: GardenBed[]
  devices: GardenDevice[]
}

/** One row of the game's own catalogue: its numbers and its art. */
export interface CatalogueEntry {
  code: string
  rarity: Rarity
  name: string
  /** rewardPoolBaseWeight: the real biopoint weight, when the game reported one. */
  biopoints: number | null
  growthSec: number | null
  image: string | null
}

/** A kind of plot or pen, with what the game says it accepts. */
export interface CatalogueBed {
  code: string
  rarity: Rarity | null
  /** "plots" or "animals". */
  groupCode: string
  /** e.g. "cattle", "vegetable_plot". */
  typeCode: string
  growthTimeModifier: number
  /** Produce types this bed works with, straight from the game. */
  compatible: string[]
  image: string | null
}

export interface Catalogue {
  vegetables: CatalogueEntry[]
  seeds: CatalogueEntry[]
  beds: CatalogueBed[]
  /** Lamps and other placeables, for their art and modifiers. */
  devices: CatalogueBed[]
}

export const emptyCatalogue: Catalogue = {
  vegetables: [],
  seeds: [],
  beds: [],
  devices: [],
}

/** A row of the game inventory, kept verbatim so nothing useful is thrown away. */
export interface InventoryItem {
  itemType: string
  code: string
  rarity: Rarity | null
  name: string
  count: number
}

export interface CraftItem {
  itemType: string
  code: string
  count: number
}

export interface CraftRecipe {
  code: string
  isDefault: boolean
  requiredItems: CraftItem[]
  resultGroups: { code: string; items: CraftItem[] }[]
}

export interface CraftOffer {
  code: string
  groupCode: string
  craftingTimeSeconds: number
  recipes: CraftRecipe[]
}

/** A live reward-pool block: what it pays and how much of it is yours. */
export interface PoolBlock {
  code: string
  groupCode: string
  currency: string
  payout: number
  totalWeight: number
  userWeight: number
  startDate: string
  endDate: string
  explorerURL: string
}

export interface PoolGroup {
  groupCode: string
  title: string
  currency: string
  icon: string | null
  blockTimeSeconds: number
}

export interface PoolLevel {
  code: string
  level: number
  points: number
  visualMaxPoints: number
  icon: string | null
}

/** A settled block: what it actually paid you. */
export interface PoolPayout {
  code: string
  currency: string
  amount: number
  totalWeight: number
  userWeight: number
  created: string
  explorerTxURL: string
}

/** One rung of the tier ladder. */
export interface PoolTier {
  code: string
  level: number
  pointsToClaim: number
  icon: string | null
}

export interface Pools {
  blocks: PoolBlock[]
  groups: PoolGroup[]
  level: PoolLevel | null
  levels: PoolTier[]
  payouts: PoolPayout[]
}

export const emptyPools: Pools = {
  blocks: [],
  groups: [],
  level: null,
  levels: [],
  payouts: [],
}

export interface Inventory {
  seeds: SeedStack[]
  plots: PlotGroup[]
  /** Present only when the layout was imported. Empty means "planning by hand". */
  gardens: Garden[]
  /** Everything the game listed, including animals, harvest and fertilizers. */
  items: InventoryItem[]
  /** Crafting recipes as the game reports them. */
  crafting: CraftOffer[]
  /** Live reward-pool blocks, the pool groups and your tier. */
  pools: Pools
}
