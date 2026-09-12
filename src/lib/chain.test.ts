import { describe, expect, it } from 'vitest'
import {
  CURRENCY_TOKENS,
  buildMarketHistory,
  buildWeightLookup,
  findVault,
  judgeLiveBlock,
  readVault,
  settledCloses,
  splitTokenName,
  type MarketBlock,
  type TokenTx,
} from './chain'
import { emptyCatalogue, type PoolBlock } from './types'

const CFB = CURRENCY_TOKENS.CFB!.address
const VAULT = '0x2c234e68dAAA98da8BaddebEb1785BB9D5412cD0'
const ZERO = '0x0000000000000000000000000000000000000000'

function tx(overrides: Partial<TokenTx>): TokenTx {
  return {
    blockNumber: '1',
    timeStamp: '1789200000',
    from: ZERO,
    to: VAULT,
    value: '1',
    contractAddress: '0xcrop',
    tokenName: 'Common Strawberry',
    tokenSymbol: 'CST',
    hash: '0xhash',
    ...overrides,
  }
}

describe('splitTokenName', () => {
  it('reads the rarity off the front and codes the rest', () => {
    expect(splitTokenName('Common Peacock Feather')).toEqual({ rarity: 'common', rest: 'peacock_feather' })
    expect(splitTokenName('Legendary Egg')).toEqual({ rarity: 'legendary', rest: 'egg' })
  })

  it('refuses a name that does not start with a rarity', () => {
    expect(splitTokenName('Chainer Fidelity Bonds')).toBeNull()
    expect(splitTokenName('Common')).toBeNull()
  })
})

describe('buildWeightLookup', () => {
  it('prefers the live catalogue and falls back to the docs', () => {
    const weightOf = buildWeightLookup({
      ...emptyCatalogue,
      vegetables: [
        { code: 'common_strawberry', rarity: 'common', name: 'strawberry', biopoints: 42, growthSec: null, image: null },
      ],
    })
    expect(weightOf('Common Strawberry')).toBe(42)
    // Not in the capture, but the docs know the sweet potato family.
    expect(weightOf('Rare Sweet Potato')).toBeGreaterThan(0)
    // Animal products come from the docs too.
    expect(weightOf('Common Firebird Feather')).toBe(30000)
    // Spelling drifts between the chain, the catalogue and the docs; separators never matter.
    expect(weightOf('Common White Lilly')).toBe(weightOf('Common White Lily'))
    expect(weightOf('Common Dragon Fruit')).toBeGreaterThan(0)
  })

  it('never guesses a crop it cannot name', () => {
    const weightOf = buildWeightLookup(emptyCatalogue)
    expect(weightOf('Common Moon Rock')).toBeNull()
    expect(weightOf('Chainer Fidelity Bonds')).toBeNull()
  })
})

describe('findVault', () => {
  it('picks the tier by the exact funding amount', () => {
    const rows = [
      tx({ contractAddress: CFB, to: '0xtier1', value: '3675000000000' }),
      tx({ contractAddress: CFB, to: '0xtier2', value: '850000000000' }),
      tx({ contractAddress: CFB, to: '0xtier3', value: '2080000000000' }),
    ]
    expect(findVault(rows, CFB, 850_000_000_000)).toBe('0xtier2')
    expect(findVault(rows, CFB, 1)).toBeNull()
  })
})

describe('readVault', () => {
  it('sums weighed crops, keeps the payout and counts the payees', () => {
    const weightOf = (name: string) => (name === 'Common Strawberry' ? 10 : name === 'Rare Egg' ? 500 : null)
    const rows = [
      tx({ contractAddress: CFB, value: '850000000000', timeStamp: '1789200000' }),
      tx({ from: '0xa', value: '3', timeStamp: '1789201000' }),
      tx({ from: '0xb', value: '1', tokenName: 'Rare Egg', timeStamp: '1789202000' }),
      tx({ from: '0xa', value: '2', timeStamp: '1789203000' }),
      tx({ from: VAULT, to: '0xa', contractAddress: CFB, value: '500000000000', timeStamp: '1789214500' }),
      tx({ from: VAULT, to: '0xb', contractAddress: CFB, value: '350000000000', timeStamp: '1789214502' }),
    ]
    const block = readVault(rows, VAULT, 'CFB', weightOf)
    expect(block.payout).toBe(850_000_000_000)
    expect(block.totalWeight).toBe(3 * 10 + 500 + 2 * 10)
    expect(block.contributions).toBe(3)
    expect(block.contributors).toBe(2)
    expect(block.payees).toBe(2)
    expect(block.unknown).toEqual([])
    expect(block.openAt).toBe(new Date(1789200000 * 1000).toISOString())
    expect(block.closeAt).toBe(new Date(1789214500 * 1000).toISOString())
  })

  it('marks a block incomplete when a crop cannot be weighed', () => {
    const rows = [tx({ tokenName: 'Common Moon Rock', value: '5' })]
    const block = readVault(rows, VAULT, 'CFB', () => null)
    expect(block.unknown).toEqual(['Common Moon Rock'])
    expect(block.totalWeight).toBe(0)
  })
})

function block(closeAt: string, payout: number, totalWeight: number, unknown: string[] = []): MarketBlock {
  return {
    key: `CFB:${closeAt}`,
    currency: 'CFB',
    vault: VAULT,
    openAt: closeAt,
    closeAt,
    payout,
    totalWeight,
    contributions: 1,
    contributors: 1,
    payees: 1,
    unknown,
  }
}

/** A close at the given local hour today. */
function localClose(hour: number, dayOffset = 0): string {
  const at = new Date()
  at.setDate(at.getDate() - dayOffset)
  at.setHours(hour, 49, 18, 0)
  return at.toISOString()
}

describe('buildMarketHistory', () => {
  it('rates each closing hour against the window mean and skips incomplete blocks', () => {
    const blocks = [
      block(localClose(8), 850, 100),
      block(localClose(8, 1), 850, 100),
      block(localClose(12), 850, 200),
      block(localClose(12, 1), 850, 200),
      block(localClose(16), 850, 50, ['Common Moon Rock']),
    ]
    const history = buildMarketHistory('CFB', blocks)
    expect(history.complete).toBe(4)
    expect(history.blocks).toHaveLength(5)
    expect(history.slots.map((slot) => slot.hour)).toEqual([8, 12])
    const eight = history.slots.find((slot) => slot.hour === 8)!
    const twelve = history.slots.find((slot) => slot.hour === 12)!
    expect(eight.rate).toBeCloseTo(8.5)
    expect(twelve.rate).toBeCloseTo(4.25)
    // Mean of (8.5, 8.5, 4.25, 4.25) is 6.375.
    expect(eight.index).toBeCloseTo(8.5 / 6.375)
    expect(history.best?.hour).toBe(8)
    expect(history.worst?.hour).toBe(12)
  })
})

describe('judgeLiveBlock', () => {
  const live = (endDate: string, totalWeight: number): PoolBlock => ({
    code: 'farmCFB_0',
    groupCode: 'farmCFB',
    currency: 'CFB',
    payout: 850,
    totalWeight,
    userWeight: 0,
    startDate: endDate,
    endDate,
    explorerURL: '',
  })

  const history = buildMarketHistory('CFB', [
    ...[0, 1, 2].map((day) => block(localClose(8, day), 850, 100)),
    ...[0, 1, 2].map((day) => block(localClose(12, day), 850, 200)),
  ])

  it('calls a well-paying hour good and a poor one wait, naming the better slot', () => {
    expect(judgeLiveBlock(live(localClose(8), 10), history).verdict).toBe('good')
    const poor = judgeLiveBlock(live(localClose(12), 10), history)
    expect(poor.verdict).toBe('wait')
    expect(poor.better?.hour).toBe(8)
  })

  it('downgrades a good hour that is already crowded', () => {
    const crowded = judgeLiveBlock(live(localClose(8), 130), history)
    expect(crowded.crowd).toBeCloseTo(1.3)
    expect(crowded.verdict).toBe('average')
  })

  it('stays neutral without a day of evidence', () => {
    const thin = buildMarketHistory('CFB', [block(localClose(8), 850, 100)])
    expect(judgeLiveBlock(live(localClose(8), 10), thin).verdict).toBe('average')
  })
})

describe('settledCloses', () => {
  it('walks back from the live close in whole blocks, skipping the unsettled one', () => {
    const now = Date.parse('2026-09-12T10:00:00Z')
    const closes = settledCloses('2026-09-12T12:49:18Z', 14_400, 3, now)
    expect(closes).toEqual([
      '2026-09-12T08:49:18.000Z',
      '2026-09-12T04:49:18.000Z',
      '2026-09-12T00:49:18.000Z',
    ])
  })

  it('waits for the grace period before counting a fresh close', () => {
    const now = Date.parse('2026-09-12T08:50:00Z')
    expect(settledCloses('2026-09-12T12:49:18Z', 14_400, 1, now)).toEqual(['2026-09-12T04:49:18.000Z'])
  })
})
