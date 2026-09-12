import type {
  Catalogue,
  CraftOffer,
  CraftRecipe,
  Inventory,
  InventoryItem,
  Rarity,
} from './types'

/**
 * What you could feed your animals with, right now.
 *
 * Animal products are worth far more biopoints than crops, but they are gated behind feed,
 * and feed is crafted from harvest. So the question a player actually has is not "what is a
 * truffle worth" but "how much feed can I make with what is already in my barn".
 *
 * That part is answerable from data the game hands over: the inventory lists the harvest, and
 * the crafting offers list the recipes. What the game has NOT been seen to report is how much
 * an animal eats per day, so this stops at "how much feed you can make" and says so rather
 * than inventing a feeding rate.
 */
export interface FeedOption {
  /** The offer code, e.g. "epic_bird_food". */
  code: string
  name: string
  rarity: Rarity | null
  /** How many times the recipe can be run with what is in the inventory. */
  crafts: number
  /** Feed produced if every craft rolls its worst result group. */
  feedMin: number
  /** Feed produced if every craft rolls its best result group. */
  feedMax: number
  /** What one craft consumes, for showing the shopping list. */
  cost: { name: string; code: string; count: number; owned: number }[]
  /** Ingredients that ran out first, if any. */
  blockedBy: string[]
  craftingTimeSeconds: number
}

export interface FeedChoice {
  code: string
  name: string
  rarity: Rarity
  owned: number
  /** How many you could craft right now from the harvest you hold. */
  craftable: number
  /**
   * True when you own a seed for every ingredient, so you can keep making this forever.
   * Harvest in the bag runs out; a renewable seed does not.
   */
  sustainable: boolean
  /** Ingredients you cannot currently grow, when it is not sustainable. */
  cannotGrow: string[]
  /**
   * The recipe, ingredient by ingredient.
   *
   * A recipe's ingredients carry their own rarity in their codes, so epic feed is made from
   * epic produce and nothing else. Holding an epic pea and a rare corn makes neither the epic
   * recipe nor the rare one, and only listing both recipes makes that visible.
   */
  needs: FeedNeed[]
  growthSec: number | null
  image: string | null
}

export interface FeedNeed {
  /** e.g. "epic_corn". */
  code: string
  name: string
  count: number
  /** How many of that exact item, at that exact rarity, you hold. */
  owned: number
  /** The seed that grows it, e.g. "epic corn seeds". */
  seed: string
  hasSeed: boolean
}

/** What a pen is expected to produce, and on what assumption. */
export interface AnimalOutput {
  /** e.g. "epic_milk". */
  productCode: string
  productName: string
  biopointsEach: number
  growthSec: number
  /** Feedings that finish inside the window. */
  cycles: number
  biopointsPerDay: number
}

export interface FarmAnimal {
  id: string
  /** The pen's item code, e.g. "common_cattle". */
  code: string
  name: string
  rarity: Rarity
  /** e.g. "cattle". */
  typeCode: string
  image: string | null
  /** What is growing in the pen right now, if anything. */
  feeding: string | null
  /** Every feed that fits this animal, best rarity first. */
  feeds: FeedChoice[]
  /** The best one actually on hand. */
  best: FeedChoice | null
  /** The best you could put in the pen today: owned, or craftable right now. */
  obtainable: FeedChoice | null
  /** The best you can keep making, because you own the seeds for its ingredients. */
  sustainable: FeedChoice | null
  /**
   * What to actually put in the pen: the strongest feed you can make, renewable first.
   *
   * Holding a feed is not the same as being able to make it. A legendary feed from an event
   * runs out, and its recipe may need seeds you have never owned, so it is never the
   * recommendation; the strongest craftable one is.
   */
  recommended: FeedChoice | null
  /** Feed on hand that cannot be made again: worth using, not worth planning around. */
  stockOnly: FeedChoice | null
  /**
   * With nothing craftable, the recipe that is fewest seeds away, lowest rarity on a tie,
   * and exactly what it is short of.
   */
  nearest: { feed: FeedChoice; short: FeedNeed[] } | null
  /** When nothing is on hand: the cheapest recipe that would fix it. */
  /**
   * Why this animal cannot be fed for good, ingredient by ingredient.
   *
   * "You have no feed" is a dead end; "you are missing corn seeds" is a shopping list. Every
   * ingredient carries both the produce you hold and the seed that makes more of it, because
   * owning three corn is a meal and owning the corn seed is a supply.
   */
  missing: {
    feed: string
    image: string | null
    needs: {
      name: string
      count: number
      owned: number
      /** The seed that grows this ingredient, e.g. "common corn seeds". */
      seed: string
      hasSeed: boolean
    }[]
  } | null
  /** With the best feed on hand. Null when there is none, or no product is known. */
  output: AnimalOutput | null
  /** With the best feed you can keep making, falling back to what you can get today. */
  ideal: AnimalOutput | null
}

export interface FeedReport {
  animals: FarmAnimal[]
  hungry: number
  options: FeedOption[]
  /** Biopoints per day from animals with the feed on hand. */
  biopointsPerDay: number
  /** Biopoints per day if every pen ran the best feed it can keep making. */
  idealBiopointsPerDay: number
  /** True when the capture had recipes at all. */
  hasRecipes: boolean
  /** True when product values were found, so the numbers above mean something. */
  hasOutput: boolean
}

const FOOD_PATTERN = /food|feed/i
const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

/** "epic_cattle_food" -> "Epic Cattle Food", and "common_cattle" -> "Common Cattle". */
function normaliseName(code: string): string {
  return code
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
const prettify = normaliseName

/** Counts of everything on hand, keyed by item code. */
function ownedByCode(items: InventoryItem[]): Map<string, number> {
  const owned = new Map<string, number>()
  for (const item of items) {
    owned.set(item.code, (owned.get(item.code) ?? 0) + item.count)
  }
  return owned
}

function isFeedOffer(offer: CraftOffer): boolean {
  if (FOOD_PATTERN.test(offer.groupCode) || FOOD_PATTERN.test(offer.code)) return true
  return offer.recipes.some((recipe) =>
    recipe.resultGroups.some((group) => group.items.some((item) => FOOD_PATTERN.test(item.code))),
  )
}

const DAY_SECONDS = 86_400

/** True when one of the recipe's result groups contains the feed. */
function recipeYields(recipe: CraftRecipe, feedCode: string): boolean {
  return recipe.resultGroups.some((group) => group.items.some((item) => item.code === feedCode))
}

/** Feed one recipe makes from what is on hand, or null when it cannot run even once. */
function craftsFrom(
  recipe: CraftRecipe,
  feedCode: string,
  owned: Map<string, number>,
): number | null {
  let runs = Number.POSITIVE_INFINITY
  for (const item of recipe.requiredItems) {
    const have = owned.get(item.code) ?? 0
    runs = Math.min(runs, item.count > 0 ? Math.floor(have / item.count) : 0)
  }
  if (!Number.isFinite(runs) || runs <= 0) return null

  const perRun = Math.min(
    ...recipe.resultGroups.map((group) =>
      group.items
        .filter((item) => item.code === feedCode)
        .reduce((sum, item) => sum + item.count, 0),
    ),
  )
  return runs * Math.max(0, perRun)
}

/** One crafting offer as a feed option, or null when it is not a feed or has no recipe. */
function feedOptionFor(offer: CraftOffer, owned: Map<string, number>): FeedOption | null {
  if (!isFeedOffer(offer)) return null

  const recipe = offer.recipes.find((candidate) => candidate.isDefault) ?? offer.recipes[0]
  if (!recipe || recipe.requiredItems.length === 0) return null

  let crafts = Number.POSITIVE_INFINITY
  const blockedBy: string[] = []
  const cost = recipe.requiredItems.map((item) => {
    const have = owned.get(item.code) ?? 0
    const possible = item.count > 0 ? Math.floor(have / item.count) : 0
    if (possible < crafts) crafts = possible
    return { name: prettify(item.code), code: item.code, count: item.count, owned: have }
  })

  if (!Number.isFinite(crafts)) crafts = 0
  for (const item of cost) {
    const possible = item.count > 0 ? Math.floor(item.owned / item.count) : 0
    if (possible === crafts) blockedBy.push(item.name)
  }

  // A recipe with several result groups is a roll: report both ends rather than an average
  // nobody can verify.
  const perGroup = recipe.resultGroups.map((group) =>
    group.items.reduce((sum, item) => sum + item.count, 0),
  )
  const feedPerCraftMin = perGroup.length > 0 ? Math.min(...perGroup) : 0
  const feedPerCraftMax = perGroup.length > 0 ? Math.max(...perGroup) : 0

  const rarity = (offer.code.split('_')[0] ?? '') as Rarity
  const known: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

  return {
    code: offer.code,
    name: prettify(offer.code),
    rarity: known.includes(rarity) ? rarity : null,
    crafts,
    feedMin: crafts * feedPerCraftMin,
    feedMax: crafts * feedPerCraftMax,
    cost,
    blockedBy: crafts > 0 ? [] : [...new Set(blockedBy)],
    craftingTimeSeconds: offer.craftingTimeSeconds,
  }
}

/**
 * The recipe closest to being makeable.
 *
 * Fewest ingredients with neither the produce nor its seed wins; then fewest ingredients
 * short at all; then the lowest rarity, because a common feed is the one to reach first.
 */
function nearestRecipe(feeds: FeedChoice[]): { feed: FeedChoice; short: FeedNeed[] } | null {
  const known = feeds.filter((feed) => feed.needs.length > 0)
  if (known.length === 0) return null
  const score = (feed: FeedChoice) => {
    const short = feed.needs.filter((need) => need.owned < need.count)
    const dead = short.filter((need) => !need.hasSeed)
    return [dead.length, short.length, RARITY_ORDER.indexOf(feed.rarity)] as const
  }
  const ranked = [...known].sort((a, b) => {
    const [ad, as_, ar] = score(a)
    const [bd, bs, br] = score(b)
    return ad - bd || as_ - bs || ar - br
  })
  const feed = ranked[0]!
  return { feed, short: feed.needs.filter((need) => need.owned < need.count) }
}

export function buildFeedReport(inventory: Inventory, catalogue: Catalogue): FeedReport {
  const owned = ownedByCode(inventory.items)

  const bedByCode = new Map(catalogue.beds.map((bed) => [bed.code, bed]))
  const produceByCode = new Map(catalogue.vegetables.map((item) => [item.code, item]))

  /**
   * How many of a feed the harvest on hand could make.
   *
   * Recipes take same-rarity ingredients, so an uncommon feed is gated by uncommon produce.
   * Counting this is what separates "a legendary feed exists" from "you can have one today",
   * and only the second is worth planning around.
   */
  /**
   * Can this feed be made again and again?
   *
   * A recipe takes produce, produce comes from a seed, and a renewable seed comes back on
   * harvest. So owning the seed for every ingredient means the feed never runs out — which is
   * a completely different answer from "there is some corn in my bag today".
   *
   * Seed codes are the produce code plus `_seeds`: `legendary_strawberry` grows from
   * `legendary_strawberry_seeds`, confirmed by what the game returns when planting.
   */
  /** The recipe for one feed, with what you hold of each ingredient. */
  const needsFor = (feedCode: string): FeedNeed[] => {
    for (const offer of inventory.crafting) {
      for (const recipe of offer.recipes) {
        const yields = recipe.resultGroups.some((group) =>
          group.items.some((item) => item.code === feedCode),
        )
        if (!yields || recipe.requiredItems.length === 0) continue

        return recipe.requiredItems.map((item) => ({
          code: item.code,
          name: normaliseName(item.code),
          count: item.count,
          owned: owned.get(item.code) ?? 0,
          seed: normaliseName(`${item.code}_seeds`),
          hasSeed: (owned.get(`${item.code}_seeds`) ?? 0) > 0,
        }))
      }
    }
    return []
  }

  const growability = (feedCode: string): { sustainable: boolean; cannotGrow: string[] } => {
    for (const offer of inventory.crafting) {
      for (const recipe of offer.recipes) {
        const yields = recipe.resultGroups.some((group) =>
          group.items.some((item) => item.code === feedCode),
        )
        if (!yields || recipe.requiredItems.length === 0) continue

        const cannotGrow = recipe.requiredItems
          .filter((item) => (owned.get(`${item.code}_seeds`) ?? 0) <= 0)
          .map((item) => normaliseName(item.code))

        return { sustainable: cannotGrow.length === 0, cannotGrow }
      }
    }
    return { sustainable: false, cannotGrow: [] }
  }

  const craftableCount = (feedCode: string): number => {
    for (const offer of inventory.crafting) {
      for (const recipe of offer.recipes) {
        if (!recipeYields(recipe, feedCode) || recipe.requiredItems.length === 0) continue

        const crafts = craftsFrom(recipe, feedCode, owned)
        if (crafts !== null) return crafts
      }
    }
    return 0
  }

  /**
   * What a pen makes when fed.
   *
   * The pen's bed type lists the produce it works with, and the produce catalogue carries its
   * `rewardPoolBaseWeight`. The one thing the game does not spell out is which RARITY of
   * produce a given feed yields, so this assumes it matches the feed — the pattern every other
   * part of the farm follows. That assumption is labelled in the UI rather than hidden.
   */
  const outputFor = (bedCode: string, feed: FeedChoice | undefined): AnimalOutput | null => {
    if (!feed) return null

    const produceTypes = bedByCode.get(bedCode)?.compatible ?? []
    for (const type of produceTypes) {
      const product = produceByCode.get(`${feed.rarity}_${type}`)
      if (!product?.biopoints) continue

      const growthSec = feed.growthSec ?? product.growthSec ?? 0
      if (growthSec <= 0) continue

      const cycles = Math.floor(DAY_SECONDS / growthSec)
      return {
        productCode: product.code,
        productName: normaliseName(product.code),
        biopointsEach: product.biopoints,
        growthSec,
        cycles,
        biopointsPerDay: cycles * product.biopoints,
      }
    }
    return null
  }

  /**
   * Every feed that fits one animal, strongest first.
   *
   * The pen's own code carries the animal type ("cattle" in "common_cattle"), and feed is
   * named after the same type ("epic_cattle_food"). Rarity is the only thing that varies, and
   * a better feed is always the better choice, so the list is simply sorted by it.
   */
  const feedsMatching = (typeCode: string): FeedChoice[] => {
    if (!typeCode) return []
    const suffix = `${typeCode.replace(/[^a-z0-9_]/gi, '')}_food`.toLowerCase()
    return catalogue.seeds
      .filter((seed) => {
        // "<type>_food" at the very end, either the whole code or right after an underscore.
        const head = seed.code.length - suffix.length
        return (
          head >= 0 &&
          seed.code.slice(head).toLowerCase() === suffix &&
          (head === 0 || seed.code.charAt(head - 1) === '_')
        )
      })
      .map((seed) => {
        const grow = growability(seed.code)
        return {
          code: seed.code,
          name: normaliseName(seed.code),
          rarity: seed.rarity,
          owned: owned.get(seed.code) ?? 0,
          craftable: craftableCount(seed.code),
          sustainable: grow.sustainable,
          cannotGrow: grow.cannotGrow,
          needs: needsFor(seed.code),
          growthSec: seed.growthSec,
          image: seed.image,
        }
      })
      .sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity))
  }

  /**
   * A pen carries more than one name for what it is.
   *
   * `common_chicken_coop` has a type code, a group code and the tail of its own item code, and
   * the feed is named after exactly one of them. Trying each in turn is not guessing: every
   * candidate comes from the game's own catalogue, and a name that matches no feed simply
   * yields nothing, which is reported rather than filled in.
   */
  const feedsFor = (...candidates: string[]): FeedChoice[] => {
    for (const candidate of candidates) {
      const feeds = feedsMatching(candidate)
      if (feeds.length > 0) return feeds
    }
    return []
  }

  /**
   * The feed family a pen is demonstrably eating.
   *
   * `common_domestic_bird` is fed `epic_bird_food`: the pen's own names never contain "bird"
   * on its own, so no amount of guessing from the pen would find the feed. What the game put
   * in the pen does, and that is an observation rather than an inference.
   */
  const familyOfPlanted = (plantedSeedCode: string | null): string => {
    if (!plantedSeedCode) return ''
    const prefix = RARITY_ORDER.find(
      (rarity) => plantedSeedCode.slice(0, rarity.length + 1).toLowerCase() === `${rarity}_`,
    )
    const withoutRarity = prefix ? plantedSeedCode.slice(prefix.length + 1) : plantedSeedCode
    return withoutRarity.replace(/_food$/i, '')
  }

  /** The recipe that would produce a feed, and what it still needs. */
  /** The art the game ships for an item code, wherever it happens to be listed. */
  const imageOf = (code: string): string | null =>
    catalogue.seeds.find((entry) => entry.code === code)?.image ??
    catalogue.vegetables.find((entry) => entry.code === code)?.image ??
    null

  const recipeFor = (feedCode: string) => {
    if (!feedCode) return null

    for (const offer of inventory.crafting) {
      const recipe = offer.recipes.find((candidate) =>
        candidate.resultGroups.some((group) =>
          group.items.some((item) => item.code === feedCode),
        ),
      )
      if (!recipe) continue
      return {
        feed: normaliseName(feedCode),
        image: imageOf(feedCode),
        needs: recipe.requiredItems.map((item) => ({
          name: normaliseName(item.code),
          count: item.count,
          owned: owned.get(item.code) ?? 0,
          seed: normaliseName(`${item.code}_seeds`),
          hasSeed: (owned.get(`${item.code}_seeds`) ?? 0) > 0,
        })),
      }
    }
    return null
  }

  // Animals live in the garden layout: the game models a pen as a bed you plant feed into.
  const animals: FarmAnimal[] = inventory.gardens.flatMap((garden) =>
    garden.beds
      .filter((bed) => bed.isAnimal)
      .map((bed) => {
        const code = `${bed.rarity}_${bed.kind}`
        const entry = bedByCode.get(code)
        const typeCode = entry?.typeCode || bed.kind
        const feeds = feedsFor(
          typeCode,
          bed.kind,
          familyOfPlanted(bed.plantedSeedCode),
          // Last resort: the tail of the pen's name. "domestic_bird" eats "bird_food", and a
          // tail that names no feed in the catalogue simply matches nothing.
          bed.kind.split('_').slice(1).join('_'),
          entry?.groupCode ?? '',
        )
        const best = feeds.find((feed) => feed.owned > 0) ?? null
        // What could go in the pen today, which is what the ideal should be measured against.
        const obtainable =
          feeds.find((feed) => feed.owned > 0 || feed.craftable > 0) ?? null
        // The one worth planning around: you can make it again tomorrow, and the day after.
        const sustainable = feeds.find((feed) => feed.sustainable) ?? null
        const recommended = sustainable ?? feeds.find((feed) => feed.craftable > 0) ?? null
        const stockOnly =
          feeds.find((feed) => feed.owned > 0 && !feed.sustainable && feed.craftable === 0) ??
          null
        const nearest = recommended ? null : nearestRecipe(feeds)

        return {
          id: bed.id,
          code,
          name: normaliseName(code),
          rarity: bed.rarity,
          typeCode,
          image: bedByCode.get(code)?.image ?? null,
          feeding: bed.plantedSeedCode,
          feeds,
          best,
          // Nothing on hand: name the strongest feed that exists and what it costs.
          // Shown whenever the feed is not yet self-sustaining: with none on hand it is the
          // way in, and with some on hand it is the way to stop running out.
          missing: sustainable
            ? null
            : recipeFor((obtainable ?? best ?? feeds[0])?.code ?? ''),
          obtainable,
          sustainable,
          recommended,
          stockOnly,
          nearest,
          output: outputFor(code, best ?? undefined),
          // The ideal is what you can keep doing: the craftable feed, or failing that what is
          // on hand today.
          ideal: outputFor(code, recommended ?? best ?? undefined),
        }
      }),
  )

  const options: FeedOption[] = []

  for (const offer of inventory.crafting) {
    const option = feedOptionFor(offer, owned)
    if (option) options.push(option)
  }

  options.sort((a, b) => b.feedMax - a.feedMax || a.name.localeCompare(b.name))

  return {
    animals,
    hungry: animals.filter((animal) => !animal.feeding).length,
    options,
    biopointsPerDay: animals.reduce(
      (sum, animal) => sum + (animal.output?.biopointsPerDay ?? 0),
      0,
    ),
    idealBiopointsPerDay: animals.reduce(
      (sum, animal) => sum + (animal.ideal?.biopointsPerDay ?? 0),
      0,
    ),
    hasOutput: animals.some((animal) => animal.ideal !== null),
    hasRecipes: inventory.crafting.length > 0,
  }
}
