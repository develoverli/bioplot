import animalsJson from '../../data/animals.json'
import { seeds } from './catalog'
import type { Catalogue, PoolBlock, Rarity } from './types'
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
}

export function blockKey(currency: string, closeAt: string): string {
  return `${currency}:${closeAt}`
}

export type WeightLookup = (tokenName: string) => number | null

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

  const cache = new Map<string, number | null>()
  return (tokenName) => {
    const hit = cache.get(tokenName)
    if (hit !== undefined) return hit
    const split = splitTokenName(tokenName)
    const key = split ? `${split.rarity}${compactKey(split.rest)}` : ''
    const weight = key ? (live.get(key) ?? docs.get(key) ?? null) : null
    cache.set(tokenName, weight)
    return weight
  }
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
  const token = CURRENCY_TOKENS[currency]?.address.toLowerCase() ?? ''
  const me = vault.toLowerCase()

  let payout = 0
  let openAt = ''
  let totalWeight = 0
  let contributions = 0
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
      const weight = weightOf(row.tokenName)
      if (weight === null) unknown.add(row.tokenName)
      else totalWeight += weight * Number(row.value)
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
  }
}

/** Currency per biopoint. Zero when the block cannot be rated. */
export function rateOfBlock(block: MarketBlock): number {
  if (block.totalWeight <= 0 || block.unknown.length > 0) return 0
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
  const decimals = CURRENCY_TOKENS[currency]?.decimals ?? 9
  return (rate / 10 ** decimals) * 1_000_000
}

/** Blockscout v1 query URLs, in one place. */
export const explorerApi = {
  blockAt: (unixSeconds: number, closest: 'before' | 'after') =>
    `${EXPLORER}/api?module=block&action=getblocknobytime&timestamp=${Math.floor(unixSeconds)}&closest=${closest}`,
  tokenTransfers: (tokenAddress: string, startBlock: number, endBlock: number) =>
    `${EXPLORER}/api?module=account&action=tokentx&contractaddress=${tokenAddress}&startblock=${startBlock}&endblock=${endBlock}&sort=asc`,
  addressTransfers: (address: string, page: number) =>
    `${EXPLORER}/api?module=account&action=tokentx&address=${address}&page=${page}&offset=10000&sort=asc`,
  addressPage: (address: string) => `${EXPLORER}/address/${address}`,
}
