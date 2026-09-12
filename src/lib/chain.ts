import animalsJson from '../../data/animals.json'
import { seeds } from './catalog'
import type { Catalogue, InventoryItem, PoolBlock, Pools, Rarity } from './types'
import { RARITIES } from './types'

/**
 * Reward pools, read off the chain instead of off the player.
 *
 * Every pool block has its own vault: a fresh address that is funded with the block's payout
 * when the block opens, receives every contributed crop as an ERC-20 transfer for four hours,
 * and pays the whole amount out to each contributor about ninety seconds after it closes. All
 * of that is public on the Chainers Chain explorer, so the rate a biopoint earned in a block
 * (`payout / total weight`) can be computed for every block, contributed to or not, without a
 * session token and without a server. See docs/market-rate.md for the probe that established
 * each step.
 */

export const EXPLORER = 'https://explorer.chainers.io'

/** The reward currencies as tokens on Chainers Chain. POL is paid as the MATIC token. */
export const CURRENCY_TOKENS: Record<string, { address: string; decimals: number }> = {
  CFB: { address: '0xeB811E3ee5e5372CBE93397770a8256E10969024', decimals: 9 },
  BNB: { address: '0x61091c8a8127a1EeD0ddACfDdb83Ae62D9f17feB', decimals: 9 },
  POL: { address: '0x2d1B7E31CB3631227Ab0DE7a6677e43782957717', decimals: 9 },
}

/** The game's spelling of a currency, mapped to the token table. POL is paid as MATIC. */
export function currencyKey(currency: string): string | null {
  // The game says "IMATIC" and "IBNB" for its internal balances of the same coins.
  const upper = currency.trim().toUpperCase().replace(/^I(?=(MATIC|BNB|POL|CFB)$)/, '')
  const key = upper === 'MATIC' ? 'POL' : upper
  return key in CURRENCY_TOKENS ? key : null
}

/** The name players know the coin by. POL is still "MATIC" in the game and on the chain. */
export function displayCurrency(currency: string): string {
  const key = currencyKey(currency)
  return key === 'POL' ? 'MATIC' : (key ?? currency)
}

export function tokenFor(currency: string): { address: string; decimals: number } | null {
  const key = currencyKey(currency)
  return key ? (CURRENCY_TOKENS[key] ?? null) : null
}

/**
 * The currency a live block pays in, wherever the capture happens to say it.
 *
 * The block row carries it when the game includes it; otherwise the pool group does, and as
 * a last resort the group code spells it ("farmCFB"). Empty when none of them do.
 */
export function blockCurrency(pools: Pools, block: PoolBlock): string {
  if (block.currency.trim()) return block.currency.trim().toUpperCase()
  const group = pools.groups.find((candidate) => candidate.groupCode === block.groupCode)
  if (group?.currency.trim()) return group.currency.trim().toUpperCase()
  const match = /(CFB|BNB|POL|MATIC)/i.exec(`${block.groupCode} ${block.code}`)
  return match?.[1]?.toUpperCase() ?? ''
}

/** How many settled blocks per currency the history keeps. Six blocks is a day. */
export const HISTORY_BLOCKS = 50

/** Payouts land within a couple of minutes of the close; wait that long before looking. */
export const SETTLE_GRACE_MS = 3 * 60_000

/** One Blockscout v1 `tokentx` row. Every field arrives as a string. */
export interface TokenTx {
  blockNumber: string
  timeStamp: string
  from: string
  to: string
  value: string
  contractAddress: string
  tokenName: string
  tokenSymbol: string
  hash: string
}

/** A settled block as the chain describes it. */
export interface MarketBlock {
  key: string
  currency: string
  vault: string
  openAt: string
  closeAt: string
  /** Raw units, the same 1e9 scale the game reports. */
  payout: number
  totalWeight: number
  contributions: number
  contributors: number
  payees: number
  /** Crop tokens with no known weight. A non-empty list makes `totalWeight` a floor. */
  unknown: string[]
  /** Units received in total, and the part of them that could not be weighed. */
  units?: number
  unknownUnits?: number
}

/**
 * How much of a block may be unweighed and still be rated.
 *
 * A block is a floor whenever one crop kind is unknown, but a floor that is within a few
 * percent of the truth is still a rate worth ranking by; a block missing a tenth of its units
 * is not. The share is by units, which is what the chain reports; the app marks such a block
 * "≈" and names the kinds so a sync with the farm open can weigh them properly.
 */
export const UNKNOWN_UNITS_LIMIT = 0.1

/** The share of a block's units that could not be weighed. Cached blocks without counts are treated as fully known only when nothing was unknown. */
export function unknownShare(block: MarketBlock): number {
  if (block.unknown.length === 0) return 0
  if (block.units === undefined || block.unknownUnits === undefined || block.units <= 0) return 1
  return block.unknownUnits / block.units
}

export function blockKey(currency: string, closeAt: string): string {
  return `${currency}:${closeAt}`
}

export type WeightLookup = (tokenName: string) => number | null

export interface WeightLookups {
  /** By the chain's token name: "Common Peacock Feather". */
  byTokenName: WeightLookup
  /** By the game's item code: "common_peacock_feather". */
  byCode: (code: string) => number | null
}

const RARITY_SET: ReadonlySet<string> = new Set(RARITIES)

/** "Common Peacock Feather" → { rarity: "common", rest: "peacock_feather" }. */
export function splitTokenName(tokenName: string): { rarity: Rarity; rest: string } | null {
  const words = tokenName.trim().toLowerCase().split(/\s+/)
  const head = words[0]
  if (!head || !RARITY_SET.has(head) || words.length < 2) return null
  return { rarity: head as Rarity, rest: words.slice(1).join('_') }
}

/**
 * Letters and digits only, so "white_lilly", "White Lilly" and "white lily" are one key.
 *
 * The chain, the catalogue and the docs each spell a crop slightly differently; separators
 * and the one known misspelling are the whole difference, so they are what is removed.
 */
function compactKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/lilly/g, 'lily')
}

/** "Sweet Potato Seed" → "sweetpotato"; "New Dragon Fruit Seeds" → "dragonfruit". */
function produceKey(seedName: string): string {
  return compactKey(
    seedName
      .toLowerCase()
      .replace(/\s*seeds?$/i, '')
      .replace(/\s*juvenile$/i, '')
      .replace(/^juvenile\s+/i, '')
      .replace(/^new\s+/i, ''),
  )
}

interface AnimalsDocs {
  groups: { group: string; products: { name: string; biopoints: number }[] }[]
}

/**
 * The weight of one unit of a crop token, live catalogue first, docs second, never guessed.
 *
 * The chain names a crop the way the game does ("Legendary Egg"), and the catalogue codes it
 * the same way with underscores ("legendary_egg"). `rewardPoolBaseWeight` from a capture is
 * the number the pool actually uses, so it wins; the docs are the fallback for a player who
 * has not synced. A token that matches neither is reported, and the block that holds it is
 * marked incomplete rather than rounded.
 */
export function buildWeightLookup(catalogue: Catalogue): WeightLookup {
  return buildWeightLookups(catalogue).byTokenName
}

export function buildWeightLookups(catalogue: Catalogue): WeightLookups {
  const live = new Map<string, number>()
  for (const entry of catalogue.vegetables) {
    if (entry.biopoints !== null && entry.biopoints > 0) {
      live.set(compactKey(entry.code), entry.biopoints)
    }
  }

  const docs = new Map<string, number>()
  for (const seed of seeds) {
    const key = produceKey(seed.name)
    for (const rarity of RARITIES) {
      const variant = seed.variants[rarity]
      if (variant) docs.set(`${rarity}${key}`, variant.biopoints)
    }
  }
  for (const group of (animalsJson as AnimalsDocs).groups) {
    for (const product of group.products) {
      const split = splitTokenName(product.name)
      if (split) docs.set(`${split.rarity}${compactKey(split.rest)}`, product.biopoints)
    }
  }

  const lookup = (key: string): number | null =>
    key ? (live.get(key) ?? docs.get(key) ?? null) : null

  const cache = new Map<string, number | null>()
  const byTokenName: WeightLookup = (tokenName) => {
    const hit = cache.get(tokenName)
    if (hit !== undefined) return hit
    const split = splitTokenName(tokenName)
    const weight = lookup(split ? `${split.rarity}${compactKey(split.rest)}` : '')
    cache.set(tokenName, weight)
    return weight
  }

  const byCode = (code: string): number | null => {
    const head = code.split('_')[0] ?? ''
    return RARITY_SET.has(head) ? lookup(compactKey(code)) : null
  }

  return { byTokenName, byCode }
}

/**
 * The harvest sitting in the bag, in biopoints: what a player could send to a pool right now.
 *
 * Only produce counts (`farmVegetables`); seeds, feed and fertilizer cannot be contributed.
 * Produce the catalogue cannot weigh is left out and named, never estimated.
 */
export function harvestWeight(
  items: InventoryItem[],
  weightOfCode: WeightLookups['byCode'],
): { weight: number; unknown: string[] } {
  let weight = 0
  const unknown = new Set<string>()
  for (const item of items) {
    if (item.itemType !== 'farmVegetables' || item.count <= 0) continue
    const each = weightOfCode(item.code)
    if (each === null) unknown.add(item.name || item.code)
    else weight += each * item.count
  }
  return { weight, unknown: [...unknown].sort() }
}

/**
 * What a contribution of `weight` biopoints would earn, in raw currency units.
 *
 * A block pays `payout × yours / total`, and the total at close is not known until the close.
 * For the live block the best estimate is the larger of what is already in it and what this
 * closing hour usually ends at; for another slot it is that slot's usual final weight. The
 * contribution itself is added to the total, so a big harvest does not pretend to be free.
 */
export function estimateEarnings(
  payoutRaw: number,
  weight: number,
  usualFinalWeight: number,
  liveWeight = 0,
): number {
  if (weight <= 0 || payoutRaw <= 0) return 0
  const total = Math.max(liveWeight, usualFinalWeight) + weight
  return total > 0 ? (payoutRaw * weight) / total : 0
}

/**
 * The vault a block was paid into.
 *
 * At the moment a block opens the game moves exactly the block's payout into a fresh
 * address: minted from zero for CFB and POL, transferred from a treasury for BNB. Four tiers
 * open at once with four different amounts, so the amount alone picks the tier's vault.
 */
export function findVault(rows: TokenTx[], tokenAddress: string, payoutRaw: number): string | null {
  const wanted = String(Math.round(payoutRaw))
  const token = tokenAddress.toLowerCase()
  const hit = rows.find(
    (row) => row.contractAddress.toLowerCase() === token && row.value === wanted,
  )
  return hit ? hit.to : null
}

/** Everything a vault's transfer list says about its block. */
export function readVault(
  rows: TokenTx[],
  vault: string,
  currency: string,
  weightOf: WeightLookup,
): MarketBlock {
  const token = tokenFor(currency)?.address.toLowerCase() ?? ''
  const me = vault.toLowerCase()

  let payout = 0
  let openAt = ''
  let totalWeight = 0
  let contributions = 0
  let units = 0
  let unknownUnits = 0
  const contributors = new Set<string>()
  const unknown = new Set<string>()
  let payees = 0
  let firstPayout = Number.POSITIVE_INFINITY
  let lastIn = 0

  for (const row of rows) {
    const isCurrency = row.contractAddress.toLowerCase() === token
    const at = Number(row.timeStamp) * 1000

    if (row.to.toLowerCase() === me) {
      if (isCurrency) {
        payout += Number(row.value)
        if (!openAt) openAt = new Date(at).toISOString()
        continue
      }
      contributions += 1
      contributors.add(row.from.toLowerCase())
      lastIn = Math.max(lastIn, at)
      const count = Number(row.value)
      units += count
      const weight = weightOf(row.tokenName)
      if (weight === null) {
        unknown.add(row.tokenName)
        unknownUnits += count
      } else totalWeight += weight * count
      continue
    }

    if (row.from.toLowerCase() === me && isCurrency) {
      payees += 1
      firstPayout = Math.min(firstPayout, at)
    }
  }

  const closeAt = new Date(
    Number.isFinite(firstPayout) ? firstPayout : lastIn || Date.parse(openAt) || 0,
  ).toISOString()

  return {
    key: blockKey(currency, closeAt),
    currency,
    vault,
    openAt: openAt || closeAt,
    closeAt,
    payout,
    totalWeight,
    contributions,
    contributors: contributors.size,
    payees,
    unknown: [...unknown].sort(),
    units,
    unknownUnits,
  }
}

/** Currency per biopoint. Zero when the block cannot be rated. */
export function rateOfBlock(block: MarketBlock): number {
  if (block.totalWeight <= 0 || unknownShare(block) > UNKNOWN_UNITS_LIMIT) return 0
  return block.payout / block.totalWeight
}

export interface SlotStat {
  /** Local hour the block closes, 0-23. Six slots a day, four hours apart. */
  hour: number
  blocks: number
  /** Average currency per biopoint over the complete blocks in this slot. */
  rate: number
  /** Average final weight of the slot, for judging a live block's crowd. */
  weight: number
  /** rate / the window's mean rate. 1 is average, 1.2 is twenty percent better. */
  index: number
}

export interface MarketHistory {
  currency: string
  blocks: MarketBlock[]
  /** Blocks that could be rated: every crop weighed, weight above zero. */
  complete: number
  mean: number
  slots: SlotStat[]
  best: SlotStat | null
  worst: SlotStat | null
}

/**
 * The window summarised by closing hour.
 *
 * Blocks close at the same six local hours every day, so "when is it worth contributing"
 * is a comparison of six slots. Incomplete blocks stay in the list for the table but never
 * touch an average: a floor is not a rate.
 */
export function buildMarketHistory(currency: string, blocks: MarketBlock[]): MarketHistory {
  const sorted = [...blocks].sort((a, b) => Date.parse(b.closeAt) - Date.parse(a.closeAt))
  const rated = sorted.filter((block) => rateOfBlock(block) > 0)
  const mean =
    rated.length > 0 ? rated.reduce((sum, block) => sum + rateOfBlock(block), 0) / rated.length : 0

  const buckets = new Map<number, { rate: number; weight: number; blocks: number }>()
  for (const block of rated) {
    const hour = new Date(block.closeAt).getHours()
    const bucket = buckets.get(hour) ?? { rate: 0, weight: 0, blocks: 0 }
    bucket.rate += rateOfBlock(block)
    bucket.weight += block.totalWeight
    bucket.blocks += 1
    buckets.set(hour, bucket)
  }

  const slots: SlotStat[] = [...buckets.entries()]
    .map(([hour, bucket]) => {
      const rate = bucket.rate / bucket.blocks
      return {
        hour,
        blocks: bucket.blocks,
        rate,
        weight: bucket.weight / bucket.blocks,
        index: mean > 0 ? rate / mean : 0,
      }
    })
    .sort((a, b) => a.hour - b.hour)

  const byRate = [...slots].sort((a, b) => b.rate - a.rate)

  return {
    currency,
    blocks: sorted,
    complete: rated.length,
    mean,
    slots,
    best: byRate[0] ?? null,
    worst: byRate[byRate.length - 1] ?? null,
  }
}

export type Verdict = 'good' | 'average' | 'wait'

export interface LiveJudgement {
  verdict: Verdict
  slot: SlotStat | null
  /** Live weight over the slot's usual final weight. Above 1 the block is already crowded. */
  crowd: number | null
  /** The best slot to hold the harvest for, when this one is not it. */
  better: SlotStat | null
}

/** Ten percent either side of average is the line between "sell" and "hold". */
const GOOD_INDEX = 1.1
const WAIT_INDEX = 0.9
/** A live block already carrying more than this share of its usual final weight is crowded. */
const CROWDED = 1.15

/**
 * Whether the block that is open right now is a good one to be in.
 *
 * Two readings: what this closing hour has historically paid, and how full the block already
 * is against that hour's usual final weight. A great hour that is already crowded drops one
 * step; the numbers behind both are handed back so the page can say why.
 */
export function judgeLiveBlock(live: PoolBlock, history: MarketHistory): LiveJudgement {
  const hour = new Date(live.endDate).getHours()
  const slot = history.slots.find((candidate) => candidate.hour === hour) ?? null
  if (!slot || history.complete < 6) return { verdict: 'average', slot, crowd: null, better: null }

  const crowd = slot.weight > 0 ? live.totalWeight / slot.weight : null
  let verdict: Verdict = slot.index >= GOOD_INDEX ? 'good' : slot.index <= WAIT_INDEX ? 'wait' : 'average'
  if (crowd !== null && crowd >= CROWDED) verdict = verdict === 'good' ? 'average' : 'wait'

  const better =
    verdict === 'wait' && history.best && history.best.hour !== hour ? history.best : null
  return { verdict, slot, crowd, better }
}

/**
 * The closing times of the last `count` settled blocks, newest first.
 *
 * Blocks are back to back, so every close is the live block's close minus a whole number of
 * block lengths. A close is only counted once its payouts have had time to land.
 */
export function settledCloses(
  liveEndDate: string,
  blockTimeSeconds: number,
  count: number,
  now = Date.now(),
): string[] {
  const end = Date.parse(liveEndDate)
  if (!Number.isFinite(end) || blockTimeSeconds <= 0) return []
  const step = blockTimeSeconds * 1000
  const closes: string[] = []
  let at = end
  while (at > now - SETTLE_GRACE_MS) at -= step
  for (let i = 0; i < count; i += 1) {
    closes.push(new Date(at - i * step).toISOString())
  }
  return closes
}

/** Currency per million biopoints, the scale at which the numbers stop being dust. */
export function perMillion(rate: number, currency: string): number {
  const decimals = tokenFor(currency)?.decimals ?? 9
  return (rate / 10 ** decimals) * 1_000_000
}

/** One row of a Blockscout v2 token-balance list. */
export interface TokenBalance {
  token: { name?: string | null; symbol?: string | null }
  value: string
}

/**
 * A vault's weight from what it is holding, rather than from every transfer it ever saw.
 *
 * Crops go into a vault and stay there: the payout at the close moves currency, never produce.
 * So the vault's balance of a crop IS the number of units contributed, and one balance call
 * replaces paging thousands of transfer rows. The currency itself is skipped, and a crop the
 * catalogue cannot weigh is counted in `unknownUnits` and named, never guessed.
 */
export function weighBalances(
  balances: TokenBalance[],
  currency: string,
  weightOf: WeightLookup,
): { totalWeight: number; units: number; unknownUnits: number; unknown: string[]; payout: number } {
  const coin = currencyKey(currency)
  let totalWeight = 0
  let units = 0
  let unknownUnits = 0
  let payout = 0
  const unknown = new Set<string>()

  for (const row of balances) {
    const name = row.token?.name ?? ''
    const symbol = (row.token?.symbol ?? '').toUpperCase()
    const value = Number(row.value)
    if (!Number.isFinite(value) || value <= 0) continue
    // The block's own currency: the funding, or what is left of it after the payout.
    if (currencyKey(symbol) !== null) {
      if (currencyKey(symbol) === coin) payout = value
      continue
    }
    units += value
    const weight = weightOf(name)
    if (weight === null) {
      unknown.add(name)
      unknownUnits += value
    } else {
      totalWeight += weight * value
    }
  }

  return { totalWeight, units, unknownUnits, unknown: [...unknown].sort(), payout }
}

/** Blockscout v1 query URLs, in one place. */
export const explorerApi = {
  blockAt: (unixSeconds: number, closest: 'before' | 'after') =>
    `${EXPLORER}/api?module=block&action=getblocknobytime&timestamp=${Math.floor(unixSeconds)}&closest=${closest}`,
  tokenTransfers: (tokenAddress: string, startBlock: number, endBlock: number) =>
    `${EXPLORER}/api?module=account&action=tokentx&contractaddress=${tokenAddress}&startblock=${startBlock}&endblock=${endBlock}&sort=asc`,
  addressTransfers: (address: string, page: number) =>
    `${EXPLORER}/api?module=account&action=tokentx&address=${address}&page=${page}&offset=10000&sort=asc`,
  /** What a vault holds: one call, indexed, and the fast way to weigh a block. */
  addressTokens: (address: string, cursor = '') =>
    `${EXPLORER}/api/v2/addresses/${address}/tokens?type=ERC-20${cursor}`,
  addressPage: (address: string) => `${EXPLORER}/address/${address}`,
}

/** Send in the last minutes: the block's weight is then known and nobody can pile in after you. */
export const SEND_WINDOW_MS = 5 * 60_000

/**
 * The close of the block open right now, by the schedule.
 *
 * Blocks are back to back, so from any known close every later close is a whole number of
 * block lengths away. A capture taken before the last close still tells the schedule; it only
 * stops telling the weight.
 */
export function nextCloseAfter(endDate: string, blockTimeSeconds: number, now = Date.now()): string {
  const end = Date.parse(endDate)
  if (!Number.isFinite(end) || blockTimeSeconds <= 0) return endDate
  const step = blockTimeSeconds * 1000
  let at = end
  while (at <= now) at += step
  return new Date(at).toISOString()
}

export interface PoolAssessment {
  currency: string
  live: PoolBlock
  history: MarketHistory
  /** The capture's block has already closed; `live` weights describe a finished block. */
  stale: boolean
  /** Where the block's current weight comes from. */
  weightSource: 'chain' | 'capture' | 'none'
  /** The block's weight right now, by that source. */
  liveWeight: number
  /** When the chain reading was taken, if that is the source. */
  readAt: number | null
  /** The open block's vault, when the chain reading found it. */
  vault: string | null
  /** When the block open right now closes, by the schedule: the live block's close, or a later one. */
  closesAt: string
  /** What the bag would earn if the block closed with exactly what it holds now. Meaningless when stale. */
  earnNow: number
  /** The slot this block closes in, when the window has it. */
  slot: SlotStat | null
  /** What the block is expected to end at: the larger of what is in it and the slot's usual. */
  projected: number
  /** Final weights over the window, for "where does this block sit". */
  low: number
  high: number
  /** 0 at the window's lightest block, 1 at its heaviest. Lower is better for you. */
  position: number
  /** projected / the slot's usual final weight. Below 1 is quieter than usual. */
  crowd: number
  /** Raw currency units the bag would earn here. */
  earn: number
  /** The same in USD, when a price is known for the coin. */
  earnUsd: number | null
  earnNowUsd: number | null
  /** Enough settled blocks to say anything. */
  ready: boolean
}

/**
 * Which pool to send the harvest to, right now.
 *
 * A player can contribute to any of the three pools of their tier, and each one pays a fixed
 * amount split by weight. The pool worth sending to is the one whose block is lightest
 * against its own history: currencies are not compared with each other in value, because the
 * app has no prices and will not invent them. The ranking is by where the projected final
 * weight sits between the window's lightest and heaviest block, then by the closing hour's
 * index; the earnings are shown per currency and left for the player to weigh.
 */
export interface LiveReadings {
  [currency: string]: { block: MarketBlock; at: number } | undefined
}

/** USD per whole coin, or null when the coin has no known price. */
export type PriceLookup = (currency: string) => number | null

function toUsd(raw: number, currency: string, priceOf: PriceLookup): number | null {
  const price = priceOf(currency)
  if (price === null) return null
  return (raw / 10 ** (tokenFor(currency)?.decimals ?? 9)) * price
}

export function assessPools(
  pools: Pools,
  histories: Record<string, MarketHistory>,
  bagWeight: number,
  now = Date.now(),
  readings: LiveReadings = {},
  priceOf: PriceLookup = () => null,
): PoolAssessment[] {
  const out: PoolAssessment[] = []
  for (const live of pools.blocks) {
    const currency = blockCurrency(pools, live)
    const history = histories[currency]
    if (!history || !tokenFor(currency)) continue
    const group = pools.groups.find((candidate) => candidate.groupCode === live.groupCode)
    const closesAt = nextCloseAfter(live.endDate, group?.blockTimeSeconds ?? 14_400, now)
    const stale = closesAt !== live.endDate && Date.parse(live.endDate) <= now
    const hour = new Date(closesAt).getHours()
    const slot = history.slots.find((candidate) => candidate.hour === hour) ?? null
    const rated = history.blocks.filter((block) => rateOfBlock(block) > 0)
    const weights = rated.map((block) => block.totalWeight)
    const low = weights.length > 0 ? Math.min(...weights) : 0
    const high = weights.length > 0 ? Math.max(...weights) : 0
    const usual = slot?.weight ?? (weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 0)
    // The chain reading of the open block beats the capture; a finished block says nothing
    // about the one open now, so a stale capture without a reading has no weight at all.
    const reading = readings[currency]
    const fromChain = reading && reading.block.closeAt === closesAt ? reading : null
    const weightSource: PoolAssessment['weightSource'] = fromChain ? 'chain' : stale ? 'none' : 'capture'
    const liveWeight = fromChain ? fromChain.block.totalWeight : stale ? 0 : live.totalWeight
    const projected = Math.max(liveWeight, usual)
    out.push({
      currency,
      live,
      history,
      stale,
      weightSource,
      liveWeight,
      readAt: fromChain?.at ?? null,
      vault: fromChain?.block.vault ?? null,
      closesAt,
      slot,
      projected,
      low,
      high,
      position: high > low ? Math.min(1, Math.max(0, (projected - low) / (high - low))) : 0,
      crowd: usual > 0 ? projected / usual : 0,
      earn: estimateEarnings(live.payout, bagWeight, usual, liveWeight),
      earnNow: weightSource === 'none' ? 0 : estimateEarnings(live.payout, bagWeight, 0, liveWeight),
      earnUsd: null,
      earnNowUsd: null,
      ready: history.complete >= 6,
    })
  }
  for (const entry of out) {
    entry.earnUsd = toUsd(entry.earn, entry.currency, priceOf)
    entry.earnNowUsd = entry.weightSource === 'none' ? null : toUsd(entry.earnNow, entry.currency, priceOf)
  }
  // Money first where money is known; a pool nobody can price is ranked by its own history,
  // after the priced ones, and the page says so.
  return out.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1
    const priced = (entry: PoolAssessment) => entry.earnUsd !== null && bagWeight > 0
    if (priced(a) !== priced(b)) return priced(a) ? -1 : 1
    if (priced(a) && priced(b)) return (b.earnUsd ?? 0) - (a.earnUsd ?? 0) || a.position - b.position
    return a.position - b.position || b.earn - a.earn
  })
}

/**
 * The shared history: public/pools-history.json, appended by scripts/pools-history.mjs on a
 * schedule and served next to the app. Units per crop token, no weights: the app applies the
 * player's catalogue, which knows event crops the docs do not.
 */
export const SNAPSHOT_URL = 'pools-history.json'

export interface SnapshotVault {
  vault: string
  /** Raw currency units, as a string (the amount can exceed 2^53 in the smallest unit). */
  payout: string
  paid: string
  contributions: number
  contributors: number
  payees: number
  /** Units received per crop token name: "Common Strawberry": 297. */
  units: Record<string, number>
}

export interface SnapshotBlock {
  closeAt: string
  openAt: string
  pools: Record<string, SnapshotVault[]>
}

export interface Snapshot {
  version: number
  updatedAt: string | null
  blockTimeSeconds: number
  anchorCloseAt: string
  blocks: SnapshotBlock[]
}

export function isSnapshot(value: unknown): value is Snapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { blocks?: unknown }).blocks) &&
    typeof (value as { blockTimeSeconds?: unknown }).blockTimeSeconds === 'number'
  )
}

/** A vault's crop units weighed with the best catalogue available right now. */
export function weighUnits(
  units: Record<string, number>,
  weightOf: WeightLookup,
): { totalWeight: number; unknown: string[]; units: number; unknownUnits: number } {
  let totalWeight = 0
  let total = 0
  let unknownUnits = 0
  const unknown: string[] = []
  for (const [name, count] of Object.entries(units)) {
    total += count
    const weight = weightOf(name)
    if (weight === null) {
      unknown.push(name)
      unknownUnits += count
    } else totalWeight += weight * count
  }
  return { totalWeight, unknown: unknown.sort(), units: total, unknownUnits }
}

/**
 * The snapshot's blocks for one tier of one currency, as the app's own blocks.
 *
 * The tier is the vault whose payout equals the live block's, the same rule the chain reader
 * uses. Weights are applied here, at read time, so a newer catalogue improves old blocks.
 */
/** The game's schedule and the chain's timestamps disagree by seconds; this is the slack. */
const CLOSE_TOLERANCE_MS = 10 * 60_000

export function blocksFromSnapshot(
  snapshot: Snapshot,
  currency: string,
  payoutRaw: number,
  weightOf: WeightLookup,
  /** The closes the app is keyed on. A snapshot block is filed under the nearest one. */
  closes: string[] = [],
): MarketBlock[] {
  const wanted = String(Math.round(payoutRaw))
  const key = currencyKey(currency)
  const schedule = closes.map((closeAt) => ({ closeAt, at: Date.parse(closeAt) }))
  const out: MarketBlock[] = []
  for (const block of snapshot.blocks) {
    const vaults = key ? block.pools[key] : undefined
    const vault = vaults?.find((candidate) => candidate.payout === wanted)
    if (!vault) continue
    const at = Date.parse(block.closeAt)
    const nearest = schedule.reduce<{ closeAt: string; at: number } | null>(
      (best, candidate) =>
        Math.abs(candidate.at - at) <= CLOSE_TOLERANCE_MS &&
        (!best || Math.abs(candidate.at - at) < Math.abs(best.at - at))
          ? candidate
          : best,
      null,
    )
    if (schedule.length > 0 && !nearest) continue
    const closeAt = nearest?.closeAt ?? block.closeAt
    const weighed = weighUnits(vault.units, weightOf)
    out.push({
      key: blockKey(currency, closeAt),
      currency,
      vault: vault.vault,
      openAt: block.openAt,
      closeAt,
      payout: Number(vault.payout),
      totalWeight: weighed.totalWeight,
      contributions: vault.contributions,
      contributors: vault.contributors,
      payees: vault.payees,
      unknown: weighed.unknown,
      units: weighed.units,
      unknownUnits: weighed.unknownUnits,
    })
  }
  return out
}
