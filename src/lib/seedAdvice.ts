import { buildFeedReport } from './feed'
import { matchSeedId } from './inventory'
import type { Plan } from './optimizer'
import type { Catalogue, CraftOffer, CraftRecipe, Inventory, Rarity } from './types'
import { RARITIES } from './types'

/**
 * What to merge, what to keep, and what is missing.
 *
 * Merging two seeds of one rarity into one of the next is a one-way door: merge your last two
 * common peas and nothing on the farm grows common peas again, so every feed that asks for
 * common peas is gone too. This answers the question protection-first:
 *
 * - KEEP what the current plan plants (one seed per bed that grows it at the same time, or every
 *   planting for a one-shot seed), plus one of every seed whose harvest a feed for one of your
 *   placed animals needs. A renewable seed is enough to grow it forever.
 * - MERGE only what is left over, and only with a recipe the game actually sent: its real counts
 *   and its real result, never an assumed "two for one".
 * - MISSING are the seeds a feed needs and you do not have, with the merge that would make them
 *   from your surplus when there is one.
 *
 * One step deep on purpose. A merge's result is not fed back into further merges, because a plan
 * that chains three merges is a plan nobody can check against the game.
 */

export interface SeedRef {
  /** e.g. "common_peas_seeds". */
  code: string
  /** e.g. "Peas seeds". */
  name: string
  rarity: Rarity
}

export interface SeedHolding extends SeedRef {
  owned: number
  keep: number
  surplus: number
  /** Why each kept seed is kept, e.g. "planted in 2 beds", "Common Deer Food". */
  reasons: string[]
}

export interface MergeStep {
  offerCode: string
  /** Times to run the recipe. */
  times: number
  /** What one run consumes. */
  inputs: { code: string; name: string; rarity: Rarity | null; count: number }[]
  /** What one run makes. */
  output: SeedRef & { count: number }
  /** Currency charged on top, when the game asks for any. Amount stays in the game. */
  currency: string | null
}

export type GapFix =
  | { kind: 'merge'; step: MergeStep }
  /** A recipe exists, but your surplus does not cover it yet. */
  | { kind: 'short'; step: MergeStep; have: { code: string; name: string; spare: number; count: number }[] }
  /** No captured recipe makes this seed: buy it, win it, or capture more recipes. */
  | { kind: 'obtain' }

export interface SeedGap extends SeedRef {
  /** The feeds this seed would unlock, e.g. "Common Deer Food". */
  unlocks: string[]
  /** True when one of the animals it would feed has no feed it can keep making at all. */
  blocking: boolean
  fix: GapFix
}

export interface SeedAdvice {
  missing: SeedGap[]
  merges: MergeStep[]
  keep: SeedHolding[]
  /** Recipes in the capture, and how many the game says exist (null when unknown). */
  recipesKnown: number
  recipesTotal: number | null
  /** True when at least one seed merge recipe was captured. */
  hasMergeRecipes: boolean
}

const SEED_SUFFIX = '_seeds'
const SEED_ITEM_TYPES = new Set(['farmSeed', 'farmSeeds'])

function rarityOf(code: string): Rarity | null {
  const head = code.split('_')[0] ?? ''
  return (RARITIES as readonly string[]).includes(head) ? (head as Rarity) : null
}

/** "common_peas_seeds" -> "Peas seeds": the rarity is shown as its own badge. */
function nameOf(code: string): string {
  const rarity = rarityOf(code)
  const rest = rarity ? code.slice(rarity.length + 1) : code
  const words = rest.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function seedRef(code: string, rarity: Rarity): SeedRef {
  return { code, name: nameOf(code), rarity }
}

const isSeedCode = (code: string) => code.endsWith(SEED_SUFFIX)

function isExpired(offer: CraftOffer, now: number): boolean {
  if (!offer.dateTo) return false
  const end = Date.parse(offer.dateTo)
  return Number.isFinite(end) && end < now
}

interface MergeRecipe {
  offer: CraftOffer
  recipe: CraftRecipe
  outputCode: string
  outputCount: number
}

/**
 * The seed merges the game sent, keyed by the seed they make.
 *
 * Only recipes with a single result group count: several groups means a roll, and promising the
 * good roll would break rule 4.
 */
function mergeRecipes(crafting: CraftOffer[], now: number): Map<string, MergeRecipe> {
  const byOutput = new Map<string, MergeRecipe>()
  for (const offer of crafting) {
    if (isExpired(offer, now)) continue
    const recipe = offer.recipes.find((candidate) => candidate.isDefault) ?? offer.recipes[0]
    if (!recipe || recipe.requiredItems.length === 0 || recipe.resultGroups.length !== 1) continue

    const results = recipe.resultGroups[0]?.items ?? []
    const output = results.length === 1 ? results[0] : undefined
    if (!output || !isSeedCode(output.code) || !rarityOf(output.code)) continue
    if (!recipe.requiredItems.some((item) => isSeedCode(item.code))) continue

    byOutput.set(output.code, { offer, recipe, outputCode: output.code, outputCount: output.count })
  }
  return byOutput
}

/** Seeds the plan needs at once, keyed by "seedId|rarity". */
function plannedUse(plan: Plan | null): Map<string, number> {
  const use = new Map<string, number>()
  if (!plan) return use
  for (const plot of plan.plots) {
    for (const entry of plot.entries) {
      // A renewable seed comes back, so one per bed that grows it is enough. A one-shot seed is
      // gone with every planting.
      const need = entry.renewable ? plot.plots : entry.plantings * plot.plots
      const key = `${entry.seedId}|${entry.rarity}`
      use.set(key, (use.get(key) ?? 0) + need)
    }
  }
  return use
}

export function buildSeedAdvice(
  inventory: Inventory,
  catalogue: Catalogue,
  plan: Plan | null,
  now: number = Date.now(),
): SeedAdvice {
  const owned = new Map<string, number>()
  for (const item of inventory.items) owned.set(item.code, (owned.get(item.code) ?? 0) + item.count)

  const seedCodes = inventory.items
    .filter((item) => SEED_ITEM_TYPES.has(item.itemType) && isSeedCode(item.code) && rarityOf(item.code))
    .map((item) => item.code)

  // Keep for the plan.
  const use = plannedUse(plan)
  const holdings = new Map<string, SeedHolding>()
  for (const code of new Set(seedCodes)) {
    const rarity = rarityOf(code) as Rarity
    const have = owned.get(code) ?? 0
    const seedId = matchSeedId(code.slice(rarity.length + 1))
    const beds = seedId ? (use.get(`${seedId}|${rarity}`) ?? 0) : 0
    const reasons = beds > 0 ? [`planted in ${beds} bed${beds === 1 ? '' : 's'}`] : []
    holdings.set(code, { ...seedRef(code, rarity), owned: have, keep: beds, surplus: 0, reasons })
  }

  // Keep one more of every seed a feed for a placed animal needs, and note what is missing.
  const report = buildFeedReport(inventory, catalogue)
  const feedSeeds = new Map<string, Set<string>>()
  const gapFeeds = new Map<string, { unlocks: Set<string>; blocking: boolean }>()
  const seenFeeds = new Set<string>()

  for (const animal of report.animals) {
    const starving = animal.sustainable === null
    for (const feed of animal.feeds) {
      const firstTime = !seenFeeds.has(feed.code)
      seenFeeds.add(feed.code)
      for (const need of feed.needs) {
        const seedCode = `${need.code}${SEED_SUFFIX}`
        if (!rarityOf(seedCode)) continue
        if ((owned.get(seedCode) ?? 0) > 0) {
          if (firstTime) feedSeeds.set(seedCode, (feedSeeds.get(seedCode) ?? new Set()).add(feed.name))
          continue
        }
        const gap = gapFeeds.get(seedCode) ?? { unlocks: new Set<string>(), blocking: false }
        gap.unlocks.add(feed.name)
        gap.blocking ||= starving
        gapFeeds.set(seedCode, gap)
      }
    }
  }

  for (const [code, feeds] of feedSeeds) {
    const holding = holdings.get(code)
    if (!holding) continue
    holding.keep += 1
    holding.reasons.push(...[...feeds].sort())
  }

  // Surplus is what is left after keeping. Merges below spend it, so it is tracked as it goes.
  const spare = new Map<string, number>()
  for (const holding of holdings.values()) {
    holding.keep = Math.min(holding.keep, holding.owned)
    holding.surplus = holding.owned - holding.keep
    spare.set(holding.code, holding.surplus)
  }

  /** What an input can contribute: spare for a seed, everything held for anything else. */
  const available = (code: string) => (isSeedCode(code) ? (spare.get(code) ?? 0) : (owned.get(code) ?? 0))

  const toStep = (merge: MergeRecipe, times: number): MergeStep => {
    const rarity = rarityOf(merge.outputCode) as Rarity
    return {
      offerCode: merge.offer.code,
      times,
      inputs: merge.recipe.requiredItems.map((item) => ({
        code: item.code,
        name: nameOf(item.code),
        rarity: rarityOf(item.code),
        count: item.count,
      })),
      output: { ...seedRef(merge.outputCode, rarity), count: merge.outputCount },
      currency: merge.offer.price?.currency ?? null,
    }
  }

  const runsFrom = (merge: MergeRecipe) =>
    Math.min(
      ...merge.recipe.requiredItems.map((item) =>
        item.count > 0 ? Math.floor(available(item.code) / item.count) : 0,
      ),
    )

  const spend = (merge: MergeRecipe, times: number) => {
    for (const item of merge.recipe.requiredItems) {
      if (isSeedCode(item.code)) spare.set(item.code, (spare.get(item.code) ?? 0) - item.count * times)
      else owned.set(item.code, (owned.get(item.code) ?? 0) - item.count * times)
    }
  }

  const recipes = mergeRecipes(inventory.crafting, now)

  // Missing first: a gap that unlocks a feed is worth more than a merge that only levels up.
  const missing: SeedGap[] = [...gapFeeds]
    .sort(
      ([codeA, a], [codeB, b]) =>
        Number(b.blocking) - Number(a.blocking) ||
        b.unlocks.size - a.unlocks.size ||
        RARITIES.indexOf(rarityOf(codeA) as Rarity) - RARITIES.indexOf(rarityOf(codeB) as Rarity),
    )
    .map(([code, gap]) => {
      const merge = recipes.get(code)
      let fix: GapFix = { kind: 'obtain' }
      if (merge) {
        if (runsFrom(merge) >= 1) {
          spend(merge, 1)
          fix = { kind: 'merge', step: toStep(merge, 1) }
        } else {
          fix = {
            kind: 'short',
            step: toStep(merge, 1),
            have: merge.recipe.requiredItems.map((item) => ({
              code: item.code,
              name: nameOf(item.code),
              spare: Math.max(0, available(item.code)),
              count: item.count,
            })),
          }
        }
      }
      return {
        ...seedRef(code, rarityOf(code) as Rarity),
        unlocks: [...gap.unlocks].sort(),
        blocking: gap.blocking,
        fix,
      }
    })

  // Then whatever surplus is still left, lowest rarity first.
  const merges: MergeStep[] = []
  const byInput = [...recipes.values()]
  const surplusCodes = [...holdings.values()]
    .filter((holding) => holding.surplus > 0)
    .sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || a.code.localeCompare(b.code))
    .map((holding) => holding.code)

  for (const code of surplusCodes) {
    for (const merge of byInput) {
      if (!merge.recipe.requiredItems.some((item) => item.code === code)) continue
      const times = runsFrom(merge)
      if (times <= 0) continue
      spend(merge, times)
      merges.push(toStep(merge, times))
    }
  }

  return {
    missing,
    merges,
    keep: [...holdings.values()]
      .filter((holding) => holding.keep > 0)
      .sort((a, b) => a.name.localeCompare(b.name) || RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity)),
    recipesKnown: inventory.crafting.length,
    recipesTotal: inventory.craftingTotal ?? null,
    hasMergeRecipes: recipes.size > 0,
  }
}
