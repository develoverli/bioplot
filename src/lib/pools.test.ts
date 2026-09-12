import { describe, expect, it } from 'vitest'
import { buildPoolHistory, rateOf } from './pools'
import { emptyPools, type PoolPayout, type Pools } from './types'

function payout(overrides: Partial<PoolPayout> = {}): PoolPayout {
  return {
    code: 'farmCFB_0',
    currency: 'CFB',
    amount: 679_231,
    totalWeight: 113_878_668,
    userWeight: 91,
    created: new Date().toISOString(),
    explorerTxURL: '',
    ...overrides,
  }
}

function pools(payouts: PoolPayout[]): Pools {
  return { ...emptyPools, payouts }
}

describe('rateOf', () => {
  it('matches the payout the game reported', () => {
    // 850000000000 × 91 / 113878668 = 679231, so the rate per biopoint is amount / userWeight.
    expect(rateOf(payout())).toBeCloseTo(679_231 / 91, 6)
  })

  it('falls back to total weight when the player contributed nothing', () => {
    expect(rateOf(payout({ userWeight: 0, amount: 10, totalWeight: 5 }))).toBe(2)
  })
})

describe('buildPoolHistory', () => {
  it('reports nothing for an empty history', () => {
    const history = buildPoolHistory(emptyPools)
    expect(history.count).toBe(0)
    expect(history.totals).toEqual([])
    expect(history.bestHours).toEqual([])
  })

  it('adds up a currency across the windows', () => {
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString()
    const history = buildPoolHistory(
      pools([payout({ amount: 100 }), payout({ amount: 50, created: old })]),
    )

    const cfb = history.totals.find((total) => total.currency === 'CFB')!
    expect(cfb.day).toBe(100)
    expect(cfb.week).toBe(100)
    expect(cfb.month).toBe(150)
    expect(cfb.all).toBe(150)
  })

  it('keeps currencies apart', () => {
    const history = buildPoolHistory(
      pools([payout({ currency: 'CFB' }), payout({ currency: 'IBNB', amount: 7 })]),
    )
    expect(history.totals.map((total) => total.currency).sort()).toEqual(['CFB', 'IBNB'])
  })

  it('ranks hours by what a biopoint earned', () => {
    const at = (hour: number) => {
      const date = new Date()
      date.setHours(hour, 0, 0, 0)
      return date.toISOString()
    }

    // Same payout, far less competition at 03:00, so a biopoint earned much more there.
    const history = buildPoolHistory(
      pools([
        payout({ created: at(3), amount: 1000, userWeight: 10 }),
        payout({ created: at(14), amount: 1000, userWeight: 1000 }),
      ]),
    )

    expect(history.bestHours[0]?.hour).toBe(3)
  })

  it('admits when there is not enough history to judge', () => {
    expect(buildPoolHistory(pools([payout()])).thin).toBe(true)
    expect(
      buildPoolHistory(pools(Array.from({ length: 8 }, () => payout()))).thin,
    ).toBe(false)
  })
})
