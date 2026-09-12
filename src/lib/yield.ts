import { getLampSpec, getLand, getPlotSpec, nextRarity } from './catalog'
import type { LampRarity, LampSpec, LandSpec, PlotSpec, Rarity, Seed } from './types'

/** Everything about a growing spot that changes the outcome of a harvest. */
export interface PlotContext {
  plot: PlotSpec
  lamp: LampSpec | null
  land: LandSpec
}

export interface PlotContextInput {
  plotRarity: Rarity
  lamp: LampRarity | null
  landId: string
}

export function buildPlotContext({ plotRarity, lamp, landId }: PlotContextInput): PlotContext {
  return {
    plot: getPlotSpec(plotRarity),
    lamp: getLampSpec(lamp),
    land: getLand(landId),
  }
}

export interface HarvestOutcome {
  /** Growth time after the lamp's reduction, in seconds. */
  growthSec: number
  /** Expected crop items per harvest, accounting for the plot's critical chance. */
  expectedItems: number
  /** Expected biopoints per crop item, accounting for the lamp's rarity upgrade. */
  expectedBiopointsPerItem: number
  /** Expected biopoints for one completed harvest, land multiplier included. */
  biopoints: number
  /** No critical, no rarity upgrade: the floor a harvest cannot fall below. */
  biopointsPlain: number
  /** Every harvest crits and every lamp roll upgrades: the ceiling luck can reach. */
  biopointsLucky: number
  /** Steady-state rate. Ignores the fact that a partial cycle scores nothing. */
  biopointsPerHour: number
}

/**
 * The yield model, straight from the docs:
 *
 *   growth   = base × (1 − lampReduction)
 *   items    = (1 − critChance) × normalDrop + critChance × critDrop
 *              …where a lamp REPLACES the plot's critical drop with normalDrop × lampMultiplier
 *   perItem  = (1 − upgradeChance) × bp[rarity] + upgradeChance × bp[rarity + 1]
 *   harvest  = items × perItem × landMultiplier
 */
export function harvestOutcome(seed: Seed, rarity: Rarity, ctx: PlotContext): HarvestOutcome | null {
  const variant = seed.variants[rarity]
  if (!variant) return null
  if (seed.medium !== ctx.land.medium) return null

  const { plot, lamp, land } = ctx

  const growthSec = lamp ? variant.growthSec * (1 - lamp.growthTimeReduction) : variant.growthSec

  const criticalDrop = lamp ? plot.normalDrop * lamp.criticalMultiplier : plot.criticalDrop
  const expectedItems =
    (1 - plot.criticalChance) * plot.normalDrop + plot.criticalChance * criticalDrop

  let expectedBiopointsPerItem = variant.biopoints
  if (lamp) {
    const upgraded = nextRarity(rarity)
    const upgradedVariant = upgraded ? seed.variants[upgraded] : undefined
    // At legendary there is nothing to upgrade into, so the lamp's rarity bonus is inert.
    if (upgradedVariant) {
      expectedBiopointsPerItem =
        (1 - lamp.rarityUpgradeChance) * variant.biopoints +
        lamp.rarityUpgradeChance * upgradedVariant.biopoints
    }
  }

  const biopoints = expectedItems * expectedBiopointsPerItem * land.productionMultiplier

  // The spread a player actually lives with. Criticals and lamp upgrades are dice, so the
  // expected value alone hides both how bad a quiet day looks and how good a lucky one gets.
  const upgraded = lamp ? nextRarity(rarity) : null
  const upgradedVariant = upgraded ? seed.variants[upgraded] : undefined
  const luckyPerItem = upgradedVariant ? upgradedVariant.biopoints : variant.biopoints

  const biopointsPlain = plot.normalDrop * variant.biopoints * land.productionMultiplier
  const biopointsLucky = criticalDrop * luckyPerItem * land.productionMultiplier

  return {
    growthSec,
    expectedItems,
    expectedBiopointsPerItem,
    biopoints,
    biopointsPlain,
    biopointsLucky,
    biopointsPerHour: (biopoints / growthSec) * 3600,
  }
}

/** Only harvests that FINISH inside the window score, so this floors the cycle count. */
export function completedCycles(growthSec: number, horizonSec: number): number {
  if (growthSec <= 0) return 0
  return Math.floor(horizonSec / growthSec)
}

export interface RankedVariant {
  seed: Seed
  rarity: Rarity
  outcome: HarvestOutcome
  /** Harvests that complete inside the horizon when replanted back to back. */
  cycles: number
  /** Biopoints actually banked inside the horizon. */
  horizonBiopoints: number
  /** Seconds of the horizon left over after the last completed harvest. */
  idleSec: number
  /** How many the player owns (Infinity for renewable seeds). */
  available: number
}

export interface RankOptions {
  horizonSec: number
  /** Restrict the ranking to what the player actually owns. */
  ownedOnly?: boolean
  /** seedId + rarity -> count. Renewable seeds are treated as unlimited. */
  owned?: Map<string, number>
}

export function stackKey(seedId: string, rarity: Rarity): string {
  return `${seedId}:${rarity}`
}

/** Ranks every plantable seed variant for a single kind of plot. */
export function rankVariants(
  allSeeds: Seed[],
  ctx: PlotContext,
  { horizonSec, ownedOnly = false, owned }: RankOptions,
): RankedVariant[] {
  const ranked: RankedVariant[] = []

  for (const seed of allSeeds) {
    for (const rarity of Object.keys(seed.variants) as Rarity[]) {
      const outcome = harvestOutcome(seed, rarity, ctx)
      if (!outcome) continue

      const available = seed.renewable
        ? Number.POSITIVE_INFINITY
        : (owned?.get(stackKey(seed.id, rarity)) ?? 0)
      if (ownedOnly && available <= 0) continue

      const cycles = Math.min(completedCycles(outcome.growthSec, horizonSec), available)

      ranked.push({
        seed,
        rarity,
        outcome,
        cycles,
        horizonBiopoints: cycles * outcome.biopoints,
        idleSec: horizonSec - cycles * outcome.growthSec,
        available,
      })
    }
  }

  ranked.sort((a, b) => b.horizonBiopoints - a.horizonBiopoints)
  return ranked
}
