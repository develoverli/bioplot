import { describe, expect, it } from 'vitest'
import { getSeed } from './catalog'
import type { Seed } from './types'
import { formatDuration } from './format'
import { buildPlotContext, completedCycles, harvestOutcome } from './yield'

function seed(id: string): Seed {
  const found = getSeed(id)
  if (!found) throw new Error(`fixture missing: ${id}`)
  return found
}

const sunnyCommon = buildPlotContext({
  plotRarity: 'common',
  lamp: null,
  landId: 'sunny-field',
})

describe('harvestOutcome', () => {
  it('yields exactly the seed biopoints on a common plot with no lamp', () => {
    const outcome = harvestOutcome(seed('corn-seed'), 'legendary', sunnyCommon)
    expect(outcome).not.toBeNull()
    // Common plot: 1 item, no criticals, no land bonus.
    expect(outcome!.expectedItems).toBe(1)
    expect(outcome!.biopoints).toBe(9)
    expect(outcome!.growthSec).toBe(360)
    expect(outcome!.biopointsPerHour).toBeCloseTo((9 / 360) * 3600, 6)
  })

  it('applies the plot critical chance to the item count', () => {
    const ctx = buildPlotContext({ plotRarity: 'legendary', lamp: null, landId: 'sunny-field' })
    const outcome = harvestOutcome(seed('corn-seed'), 'legendary', ctx)
    // 0.9 × 16 + 0.1 × 32 = 17.6
    expect(outcome!.expectedItems).toBeCloseTo(17.6, 10)
    expect(outcome!.biopoints).toBeCloseTo(17.6 * 9, 10)
  })

  it('lets a lamp REPLACE the plot critical multiplier and cut growth time', () => {
    const ctx = buildPlotContext({ plotRarity: 'legendary', lamp: 'common', landId: 'sunny-field' })
    const outcome = harvestOutcome(seed('corn-seed'), 'legendary', ctx)
    // Critical drop becomes 16 × 2.05 = 32.8 → 0.9 × 16 + 0.1 × 32.8 = 17.68
    expect(outcome!.expectedItems).toBeCloseTo(17.68, 10)
    expect(outcome!.growthSec).toBeCloseTo(360 * 0.97, 10)
  })

  it('blends in the next rarity when a lamp can upgrade the crop', () => {
    const ctx = buildPlotContext({ plotRarity: 'common', lamp: 'rare', landId: 'sunny-field' })
    const outcome = harvestOutcome(seed('corn-seed'), 'common', ctx)
    // 0.85 × 2 (common) + 0.15 × 3 (uncommon) = 2.15
    expect(outcome!.expectedBiopointsPerItem).toBeCloseTo(2.15, 10)
  })

  it('has no rarity bonus to give at legendary', () => {
    const ctx = buildPlotContext({ plotRarity: 'common', lamp: 'rare', landId: 'sunny-field' })
    const outcome = harvestOutcome(seed('corn-seed'), 'legendary', ctx)
    expect(outcome!.expectedBiopointsPerItem).toBe(9)
  })

  it('doubles everything on Golden Acres', () => {
    const golden = buildPlotContext({ plotRarity: 'common', lamp: null, landId: 'golden-acres' })
    const base = harvestOutcome(seed('corn-seed'), 'legendary', sunnyCommon)!
    const boosted = harvestOutcome(seed('corn-seed'), 'legendary', golden)!
    expect(boosted.biopoints).toBeCloseTo(base.biopoints * 2, 10)
  })

  it('refuses water seeds on soil land and vice versa', () => {
    expect(harvestOutcome(seed('juvenile-trout'), 'common', sunnyCommon)).toBeNull()

    const water = buildPlotContext({
      plotRarity: 'common',
      lamp: null,
      landId: 'tranquil-waters',
    })
    expect(harvestOutcome(seed('juvenile-trout'), 'common', water)).not.toBeNull()
    expect(harvestOutcome(seed('corn-seed'), 'common', water)).toBeNull()
  })

  it('returns null for a rarity the seed does not have', () => {
    expect(harvestOutcome(seed('spectral-fern'), 'legendary', sunnyCommon)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('never renders sixty minutes', () => {
    // 3599s used to round to "0h 60m" because the minutes were rounded after the split.
    expect(formatDuration(3599)).toBe('1h')
    expect(formatDuration(7199)).toBe('2h')
    expect(formatDuration(3660)).toBe('1h 1m')
    expect(formatDuration(59)).toBe('59s')
  })
})

describe('completedCycles', () => {
  it('only counts harvests that finish inside the window', () => {
    expect(completedCycles(360, 86_400)).toBe(240)
    // 46 800s bamboo fits once in a day, not 1.8 times.
    expect(completedCycles(46_800, 86_400)).toBe(1)
    expect(completedCycles(90_000, 86_400)).toBe(0)
  })
})
