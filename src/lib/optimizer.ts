import { getSeed, seeds as docSeeds } from './catalog'
import type { Inventory, LampRarity, Rarity, Seed } from './types'
import { buildPlotContext, harvestOutcome, stackKey, type PlotContext } from './yield'

export const DAY_SECONDS = 86_400
/** Schedules are quantised to whole minutes: fine enough to plan, cheap enough to solve. */
export const DEFAULT_BUCKET_SEC = 60

const EPSILON = 1e-6

export interface OptimizeOptions {
  horizonSec?: number
  bucketSec?: number
  /** Ignore the player's stock and pretend every seed is available. */
  ignoreStock?: boolean
  /**
   * The catalogue to plan against. Defaults to the numbers transcribed from the docs; pass
   * the effective catalogue to plan on the game's own live numbers instead.
   */
  seeds?: Seed[]
  /** Seed variants the player has switched off, as "seedId:rarity". */
  disabled?: ReadonlySet<string>
  /**
   * 'mix' fills every spare minute with whatever pays best, which usually means several
   * different seeds in one bed. 'single' commits each bed to one seed for the whole window:
   * worth less on paper, but it is one decision per bed instead of five.
   */
  mode?: 'mix' | 'single'
  /**
   * How often you come back to the farm, in seconds. Zero means continuously.
   *
   * A plot cannot be replanted while nobody is there, so between two visits it holds exactly
   * one crop. That turns the plan from "fill every minute" into "pick the best crop that
   * finishes before I return", which is a different answer and usually a different seed.
   */
  checkEverySec?: number
}

export interface PlanEntry {
  seedId: string
  seedName: string
  seedType: string
  rarity: Rarity
  plantings: number
  /** Growth time of one planting, after the lamp, in seconds. */
  growthSec: number
  biopointsEach: number
  biopointsTotal: number
  /** Same plantings, if every critical and every lamp roll went your way. */
  biopointsLuckyTotal: number
  /** Same plantings, with no critical and no lamp upgrade at all. */
  biopointsPlainTotal: number
  renewable: boolean
}

export interface PlotPlan {
  groupId: string
  plotRarity: Rarity
  landId: string
  lamp: LampRarity | null
  /** How many identical plots follow this exact plan. */
  plots: number
  entries: PlanEntry[]
  /** Biopoints for ONE plot following this plan. */
  biopointsPerPlot: number
  biopoints: number
  biopointsLucky: number
  biopointsPlain: number
  usedSec: number
  idleSec: number
}

export interface Plan {
  horizonSec: number
  bucketSec: number
  plots: PlotPlan[]
  totalBiopoints: number
  /** The same plan on a lucky day and on a flat one. */
  totalLucky: number
  totalPlain: number
  biopointsPerHour: number
  biopointsPerPoolCycle: number
  totalPlots: number
  warnings: string[]
}

interface Option {
  seed: Seed
  rarity: Rarity
  /** Whole buckets one planting occupies (rounded up, so plans never overpromise). */
  cost: number
  value: number
  valueLucky: number
  valuePlain: number
  growthSec: number
  /**
   * How long one planting reserves the seed itself.
   *
   * Normally the growth time: a renewable seed comes back at harvest and can go straight into
   * another plot. But when the player only visits every few hours, everything is planted at the
   * visit and nothing is replanted until the next one, so the seed is spoken for until then. Not
   * charging that let one seed fill several plots at once — a plan for seeds nobody owns.
   */
  lockSec: number
  renewable: boolean
  key: string
}

interface PlotUnit {
  groupId: string
  plotRarity: Rarity
  landId: string
  lamp: LampRarity | null
  ctx: PlotContext
  contextKey: string
}

/**
 * What is left of a seed.
 *
 * A renewable seed is infinite in TIME but not in PARALLEL: it comes back when you harvest it,
 * so one seed keeps a single plot busy all day — but it cannot grow in two plots at once. Its
 * real budget is therefore seed-seconds: `count × horizon`, spent at the growth time of each
 * planting. A one-shot seed is simply counted.
 */
interface Supply {
  renewable: boolean
  /** Seconds of simultaneous growing for renewables, plantings for one-shot seeds. */
  left: number
}

interface Solution {
  picks: Map<string, number>
  value: number
  incomplete: boolean
}

/** How many times this option may still be planted, in this plot. */
function plantingsAllowed(option: Option, supply: Map<string, Supply>, buckets: number): number {
  const stock = supply.get(option.key)
  if (!stock) return 0

  const byStock = stock.renewable ? Math.floor(stock.left / option.lockSec) : Math.floor(stock.left)
  return Math.max(0, Math.min(byStock, Math.floor(buckets / option.cost)))
}

function buildOptions(
  ctx: PlotContext,
  bucketSec: number,
  horizonSec: number,
  catalogue: Seed[],
  intervalSec: number,
): Option[] {
  const options: Option[] = []

  for (const seed of catalogue) {
    for (const rarity of Object.keys(seed.variants) as Rarity[]) {
      const outcome = harvestOutcome(seed, rarity, ctx)
      if (!outcome) continue
      if (outcome.growthSec > horizonSec) continue

      options.push({
        seed,
        rarity,
        cost: Math.max(1, Math.ceil(outcome.growthSec / bucketSec)),
        value: outcome.biopoints,
        valueLucky: outcome.biopointsLucky,
        valuePlain: outcome.biopointsPlain,
        growthSec: outcome.growthSec,
        lockSec: Math.max(outcome.growthSec, intervalSec),
        renewable: seed.renewable,
        key: stackKey(seed.id, rarity),
      })
    }
  }

  // Best density first: makes the reconstruction scan settle on the strong picks.
  options.sort((a, b) => b.value / b.cost - a.value / a.cost)
  return options
}

/**
 * One plot is one knapsack. Capacity is the horizon in buckets, an item is a single
 * planting, and only plantings that finish inside the horizon are worth anything.
 *
 * A renewable seed replants forever, but only once you own one: owning none means it cannot
 * go in the ground at all. Disposable seeds are bounded by what the player still owns, so
 * they are expanded into individual 0/1 copies.
 */
/**
 * One planting per visit.
 *
 * With a check interval, the only thing that matters per slot is the best crop that ripens
 * before you come back. A crop that takes longer is wasted: it sits ripe, or worse, is not
 * ready and the slot is lost. So each slot takes the best option that fits the interval, and
 * scarce seeds are spent slot by slot.
 */
function solveByVisits(
  options: Option[],
  buckets: number,
  supply: Map<string, Supply>,
  intervalBuckets: number,
  mode: 'mix' | 'single',
): Solution {
  const slots = Math.floor(buckets / intervalBuckets)
  if (slots <= 0) return { picks: new Map(), value: 0, incomplete: false }

  const fits = options
    .filter((option) => option.cost <= intervalBuckets)
    .sort((a, b) => b.value - a.value)

  const picks = new Map<string, number>()
  const budget = new Map<string, number>()
  for (const option of fits) {
    // Within one slot an option is planted at most once, so its per-plot cap is the slot count.
    budget.set(option.key, Math.min(slots, plantingsAllowed(option, supply, buckets)))
  }

  // "One seed per plot" still means one seed per plot when you only visit every few hours:
  // the plot is committed to a single crop, it is simply replanted at each visit.
  if (mode === 'single') {
    let best: { option: Option; plantings: number } | null = null
    for (const option of fits) {
      const plantings = Math.min(slots, budget.get(option.key) ?? 0)
      if (plantings <= 0) continue
      if (!best || plantings * option.value > best.plantings * best.option.value) {
        best = { option, plantings }
      }
    }
    if (!best) return { picks: new Map(), value: 0, incomplete: false }
    return {
      picks: new Map([[best.option.key, best.plantings]]),
      value: best.plantings * best.option.value,
      incomplete: false,
    }
  }

  let value = 0
  for (let slot = 0; slot < slots; slot++) {
    const chosen = fits.find((option) => (budget.get(option.key) ?? 0) > 0)
    if (!chosen) break

    picks.set(chosen.key, (picks.get(chosen.key) ?? 0) + 1)
    budget.set(chosen.key, (budget.get(chosen.key) ?? 0) - 1)
    value += chosen.value
  }

  return { picks, value, incomplete: false }
}

/** One seed, replanted until the window runs out. */
function solveSinglePlot(
  options: Option[],
  buckets: number,
  supply: Map<string, Supply>,
): Solution {
  let best: { option: Option; plantings: number; value: number } | null = null

  for (const option of options) {
    const plantings = plantingsAllowed(option, supply, buckets)
    if (plantings <= 0) continue

    const value = plantings * option.value
    if (best === null || value > best.value) best = { option, plantings, value }
  }

  if (!best) return { picks: new Map(), value: 0, incomplete: false }
  return {
    picks: new Map([[best.option.key, best.plantings]]),
    value: best.value,
    incomplete: false,
  }
}

function solvePlot(options: Option[], buckets: number, supply: Map<string, Supply>): Solution {
  const dp = new Float64Array(buckets + 1)
  const maxFit = (option: Option) => Math.floor(buckets / option.cost)

  for (const option of options) {
    const allowed = plantingsAllowed(option, supply, buckets)
    if (allowed <= 0) continue

    if (allowed >= maxFit(option)) {
      // Enough to fill the plot: an ascending sweep is the cheap way to say "as many as fit".
      for (let t = option.cost; t <= buckets; t++) {
        const candidate = dp[t - option.cost]! + option.value
        if (candidate > dp[t]! + EPSILON) dp[t] = candidate
      }
      continue
    }

    for (let copy = 0; copy < allowed; copy++) {
      // Bounded: a descending sweep uses each copy at most once.
      for (let t = buckets; t >= option.cost; t--) {
        const candidate = dp[t - option.cost]! + option.value
        if (candidate > dp[t]! + EPSILON) dp[t] = candidate
      }
    }
  }

  let bestT = 0
  for (let t = 1; t <= buckets; t++) {
    if (dp[t]! > dp[bestT]! + EPSILON) bestT = t
  }

  // Walk the table back down, re-deriving each step, so the plan always matches dp.
  const picks = new Map<string, number>()
  const budget = new Map<string, number>()
  for (const option of options) {
    budget.set(option.key, plantingsAllowed(option, supply, buckets))
  }

  let t = bestT
  let incomplete = false

  while (t > 0 && dp[t]! > EPSILON) {
    let chosen: Option | undefined
    for (const option of options) {
      if (option.cost > t) continue
      if ((budget.get(option.key) ?? 0) <= 0) continue
      if (Math.abs(dp[t]! - (dp[t - option.cost]! + option.value)) < EPSILON) {
        chosen = option
        break
      }
    }

    if (!chosen) {
      incomplete = true
      break
    }

    picks.set(chosen.key, (picks.get(chosen.key) ?? 0) + 1)
    budget.set(chosen.key, (budget.get(chosen.key) ?? 0) - 1)
    t -= chosen.cost
  }

  return { picks, value: dp[bestT]!, incomplete }
}

function toEntries(picks: Map<string, number>, options: Option[]): PlanEntry[] {
  const byKey = new Map(options.map((option) => [option.key, option]))
  const entries: PlanEntry[] = []

  for (const [key, plantings] of picks) {
    const option = byKey.get(key)
    if (!option) continue
    entries.push({
      seedId: option.seed.id,
      seedName: option.seed.name,
      seedType: option.seed.type,
      rarity: option.rarity,
      plantings,
      growthSec: option.growthSec,
      biopointsEach: option.value,
      biopointsTotal: option.value * plantings,
      biopointsLuckyTotal: option.valueLucky * plantings,
      biopointsPlainTotal: option.valuePlain * plantings,
      renewable: option.renewable,
    })
  }

  entries.sort((a, b) => b.biopointsTotal - a.biopointsTotal)
  return entries
}

function expandUnits(inventory: Inventory): PlotUnit[] {
  const units: PlotUnit[] = []

  for (const group of inventory.plots) {
    const count = Math.max(0, Math.floor(group.count))
    if (count === 0) continue

    const ctx = buildPlotContext({
      plotRarity: group.rarity,
      lamp: group.lamp,
      landId: group.landId,
    })

    for (let i = 0; i < count; i++) {
      units.push({
        groupId: group.id,
        plotRarity: group.rarity,
        landId: group.landId,
        lamp: group.lamp,
        ctx,
        contextKey: `${group.rarity}|${group.lamp ?? 'none'}|${group.landId}`,
      })
    }
  }

  return units
}

const UNLIMITED = Number.MAX_SAFE_INTEGER

/**
 * What can actually go in the ground.
 *
 * A plan that suggests a seed the player does not own is worse than useless, so ownership is
 * a hard filter, not a preference. Two cases loosen it: the explicit "show the ceiling"
 * toggle, and an inventory nobody has told us about yet, where restricting would leave the
 * planner with nothing to say.
 */
function buildStock(
  inventory: Inventory,
  ignoreStock: boolean,
  catalogue: Seed[],
  disabled: ReadonlySet<string>,
  horizonSec: number,
): Map<string, Supply> {
  const stock = new Map<string, Supply>()
  const unrestricted = ignoreStock || inventory.seeds.length === 0

  if (unrestricted) {
    for (const seed of catalogue) {
      for (const rarity of Object.keys(seed.variants) as Rarity[]) {
        const key = stackKey(seed.id, rarity)
        if (disabled.has(key)) continue
        stock.set(key, { renewable: seed.renewable, left: UNLIMITED })
      }
    }
    return stock
  }

  for (const stack of inventory.seeds) {
    const seed = getSeed(stack.seedId)
    if (!seed) continue

    const key = stackKey(stack.seedId, stack.rarity)
    if (disabled.has(key)) continue

    const count = Math.max(0, Math.floor(stack.count))
    if (count <= 0) continue

    const previous = stock.get(key)?.left ?? 0
    stock.set(key, {
      renewable: seed.renewable,
      // Renewables are budgeted in seed-seconds: N seeds can keep N plots busy for the horizon.
      left: previous + (seed.renewable ? count * horizonSec : count),
    })
  }

  return stock
}

/**
 * Builds the plan for the whole farm.
 *
 * Plots are solved one at a time, strongest first, so scarce one-shot seeds land on the
 * plots that multiply them the most. When no scarce seed is in play, plots that share a
 * context are solved once and the answer is reused.
 */
export function optimize(inventory: Inventory, options: OptimizeOptions = {}): Plan {
  const horizonSec = options.horizonSec ?? DAY_SECONDS
  const bucketSec = options.bucketSec ?? DEFAULT_BUCKET_SEC
  const ignoreStock = options.ignoreStock ?? false
  const catalogue = options.seeds ?? docSeeds
  const disabled = options.disabled ?? new Set<string>()
  const mode = options.mode ?? 'mix'
  const checkEverySec = Math.max(0, options.checkEverySec ?? 0)
  const intervalBuckets = Math.floor(checkEverySec / bucketSec)

  const solve = (opts: Option[], count: number, stock: Map<string, Supply>): Solution => {
    if (intervalBuckets > 0) return solveByVisits(opts, count, stock, intervalBuckets, mode)
    return mode === 'single' ? solveSinglePlot(opts, count, stock) : solvePlot(opts, count, stock)
  }
  const buckets = Math.floor(horizonSec / bucketSec)
  const warnings: string[] = []

  const units = expandUnits(inventory)
  if (units.length === 0) {
    return {
      horizonSec,
      bucketSec,
      plots: [],
      totalBiopoints: 0,
      totalLucky: 0,
      totalPlain: 0,
      biopointsPerHour: 0,
      biopointsPerPoolCycle: 0,
      totalPlots: 0,
      warnings: ['Add at least one plot to get a plan.'],
    }
  }

  const stock = buildStock(inventory, ignoreStock, catalogue, disabled, horizonSec)
  // Any finite supply is shared between plots, so plots must then be solved in sequence.
  const hasScarceSeeds = [...stock.values()].some(
    (supply) => supply.left > 0 && supply.left < UNLIMITED,
  )

  const optionsByContext = new Map<string, Option[]>()
  for (const unit of units) {
    if (!optionsByContext.has(unit.contextKey)) {
      optionsByContext.set(
        unit.contextKey,
        buildOptions(unit.ctx, bucketSec, horizonSec, catalogue, intervalBuckets * bucketSec),
      )
    }
  }

  // Strongest plot first. Without scarce seeds the order does not change the totals,
  // but it keeps the output stable and readable.
  const ranked = units
    .map((unit) => {
      const opts = optionsByContext.get(unit.contextKey) ?? []
      let strength = 0
      for (const option of opts) strength = Math.max(strength, option.value / option.cost)
      return { unit, strength }
    })
    .sort((a, b) => b.strength - a.strength)

  const solutionCache = new Map<string, Solution>()
  const plans: PlotPlan[] = []

  for (const { unit } of ranked) {
    const opts = optionsByContext.get(unit.contextKey) ?? []

    let solution: Solution
    if (hasScarceSeeds) {
      solution = solve(opts, buckets, stock)

      // Spend what this plot took, so the next plot sees a smaller pool.
      const lockByKey = new Map(opts.map((option) => [option.key, option.lockSec]))
      for (const [key, used] of solution.picks) {
        const supply = stock.get(key)
        if (!supply || supply.left === UNLIMITED) continue
        const spent = supply.renewable ? used * (lockByKey.get(key) ?? 0) : used
        stock.set(key, { ...supply, left: Math.max(0, supply.left - spent) })
      }
    } else {
      const cached = solutionCache.get(unit.contextKey)
      solution = cached ?? solve(opts, buckets, stock)
      if (!cached) solutionCache.set(unit.contextKey, solution)
    }

    if (solution.incomplete) {
      warnings.push(
        `Could not fully reconstruct the schedule for a ${unit.plotRarity} plot, so the plan may be conservative.`,
      )
    }

    const entries = toEntries(solution.picks, opts)
    const usedSec = entries.reduce((sum, entry) => sum + entry.growthSec * entry.plantings, 0)
    const lucky = entries.reduce((sum, entry) => sum + entry.biopointsLuckyTotal, 0)
    const plain = entries.reduce((sum, entry) => sum + entry.biopointsPlainTotal, 0)

    plans.push({
      groupId: unit.groupId,
      plotRarity: unit.plotRarity,
      landId: unit.landId,
      lamp: unit.lamp,
      plots: 1,
      entries,
      biopointsPerPlot: solution.value,
      biopoints: solution.value,
      biopointsLucky: lucky,
      biopointsPlain: plain,
      usedSec,
      idleSec: Math.max(0, horizonSec - usedSec),
    })
  }

  const merged = mergeIdenticalPlans(plans)
  const totalBiopoints = merged.reduce((sum, plan) => sum + plan.biopoints, 0)
  const totalLucky = merged.reduce((sum, plan) => sum + plan.biopointsLucky, 0)
  const totalPlain = merged.reduce((sum, plan) => sum + plan.biopointsPlain, 0)

  if (intervalBuckets > 0 && merged.some((plan) => plan.entries.length === 0)) {
    warnings.push(
      'Nothing you own ripens inside your check interval. Come back more often, or grow faster crops.',
    )
  }

  if (merged.some((plan) => plan.entries.length === 0)) {
    warnings.push(
      inventory.seeds.length > 0 && !ignoreStock
        ? 'Some plots have nothing to plant from the seeds you own. Turn on "show the ceiling" to see what they could do.'
        : 'Some plots have nothing to plant. Check the land: water seeds only grow on water plots.',
    )
  }

  return {
    horizonSec,
    bucketSec,
    plots: merged,
    totalBiopoints,
    totalLucky,
    totalPlain,
    biopointsPerHour: totalBiopoints / (horizonSec / 3600),
    biopointsPerPoolCycle: totalBiopoints / (horizonSec / (4 * 3600)),
    totalPlots: units.length,
    warnings: [...new Set(warnings)],
  }
}

/** Collapses plots that ended up with the exact same schedule into a single row. */
function mergeIdenticalPlans(plans: PlotPlan[]): PlotPlan[] {
  const merged = new Map<string, PlotPlan>()

  for (const plan of plans) {
    const signature = [
      plan.groupId,
      plan.plotRarity,
      plan.landId,
      plan.lamp ?? 'none',
      ...plan.entries.map((entry) => `${entry.seedId}:${entry.rarity}:${entry.plantings}`),
    ].join('|')

    const existing = merged.get(signature)
    if (existing) {
      existing.plots += 1
      existing.biopoints += plan.biopointsPerPlot
      existing.biopointsLucky += plan.biopointsLucky / Math.max(1, plan.plots)
      existing.biopointsPlain += plan.biopointsPlain / Math.max(1, plan.plots)
      continue
    }
    merged.set(signature, { ...plan })
  }

  return [...merged.values()].sort((a, b) => b.biopoints - a.biopoints)
}
