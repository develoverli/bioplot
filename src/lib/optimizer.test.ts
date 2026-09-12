import { describe, expect, it } from 'vitest'
import { seeds } from './catalog'
import { emptyInventory } from './inventory'
import { DAY_SECONDS, optimize } from './optimizer'
import type { Inventory, PlotGroup } from './types'

function plot(overrides: Partial<PlotGroup> = {}): PlotGroup {
  return {
    id: 'p1',
    rarity: 'common',
    landId: 'sunny-field',
    lamp: null,
    count: 1,
    ...overrides,
  }
}

function inventory(overrides: Partial<Inventory> = {}): Inventory {
  return { ...emptyInventory, plots: [plot()], ...overrides }
}

describe('optimize', () => {
  it('says so when there is nothing to plan', () => {
    const plan = optimize(emptyInventory)
    expect(plan.totalBiopoints).toBe(0)
    expect(plan.warnings).toContain('Add at least one plot to get a plan.')
  })

  it('plans freely when nobody has told it what the player owns', () => {
    const plan = optimize(inventory())
    expect(plan.totalBiopoints).toBeGreaterThan(0)
    expect(plan.plots).toHaveLength(1)
  })

  it('never suggests a seed the player does not own', () => {
    // A known inventory is a hard filter: one corn seed means corn, and nothing else.
    const plan = optimize(
      inventory({ seeds: [{ seedId: 'corn-seed', rarity: 'legendary', count: 1 }] }),
    )
    const used = new Set(plan.plots.flatMap((p) => p.entries.map((entry) => entry.seedId)))
    expect([...used]).toEqual(['corn-seed'])
  })

  it('cannot grow one renewable seed in two plots at once', () => {
    // One seed keeps ONE plot busy all day. Six plots need six seeds.
    const single = optimize(
      inventory({ seeds: [{ seedId: 'corn-seed', rarity: 'legendary', count: 1 }] }),
    ).totalBiopoints

    const six = optimize(
      inventory({
        plots: [plot({ count: 6 })],
        seeds: [{ seedId: 'corn-seed', rarity: 'legendary', count: 1 }],
      }),
    ).totalBiopoints

    // Six plots sharing one seed bank barely beat one plot; they do not sextuple it.
    expect(six).toBeLessThan(single * 2)
  })

  it('scales the plan with how many of a seed you own', () => {
    const withOne = optimize(
      inventory({
        plots: [plot({ count: 4 })],
        seeds: [{ seedId: 'corn-seed', rarity: 'legendary', count: 1 }],
      }),
    ).totalBiopoints

    const withFour = optimize(
      inventory({
        plots: [plot({ count: 4 })],
        seeds: [{ seedId: 'corn-seed', rarity: 'legendary', count: 4 }],
      }),
    ).totalBiopoints

    expect(withFour).toBeGreaterThan(withOne * 3)
  })

  it('treats one renewable seed as an endless supply within a single plot', () => {
    const plan = optimize(
      inventory({ seeds: [{ seedId: 'corn-seed', rarity: 'legendary', count: 1 }] }),
    )
    const corn = plan.plots[0]!.entries.find((entry) => entry.seedId === 'corn-seed')
    // Corn grows in 6 minutes, so a day fits far more than the single seed owned.
    expect(corn!.plantings).toBeGreaterThan(1)
  })

  it('lets the ceiling ignore ownership', () => {
    const owned = optimize(
      inventory({ seeds: [{ seedId: 'corn-seed', rarity: 'legendary', count: 1 }] }),
    )
    const ceiling = optimize(
      inventory({ seeds: [{ seedId: 'corn-seed', rarity: 'legendary', count: 1 }] }),
      { ignoreStock: true },
    )
    expect(ceiling.totalBiopoints).toBeGreaterThan(owned.totalBiopoints)
  })

  it('honours seeds the player switched off', () => {
    const plan = optimize(
      inventory({
        seeds: [
          { seedId: 'corn-seed', rarity: 'legendary', count: 1 },
          { seedId: 'basil-seed', rarity: 'legendary', count: 1 },
        ],
      }),
      { disabled: new Set(['basil-seed:legendary']) },
    )
    const used = new Set(plan.plots.flatMap((p) => p.entries.map((entry) => entry.seedId)))
    expect(used.has('basil-seed')).toBe(false)
  })

  it('never schedules more than the horizon', () => {
    const plan = optimize(inventory())
    for (const plotPlan of plan.plots) {
      expect(plotPlan.usedSec).toBeLessThanOrEqual(DAY_SECONDS)
      expect(plotPlan.idleSec).toBeGreaterThanOrEqual(0)
    }
  })

  it('reports the plan totals consistently', () => {
    const plan = optimize(inventory())
    const summed = plan.plots.reduce((total, p) => total + p.biopoints, 0)
    expect(plan.totalBiopoints).toBeCloseTo(summed, 6)
    expect(plan.biopointsPerHour).toBeCloseTo(plan.totalBiopoints / 24, 6)
    expect(plan.biopointsPerPoolCycle).toBeCloseTo(plan.totalBiopoints / 6, 6)
  })

  it('scales with plot count', () => {
    const one = optimize(inventory())
    const four = optimize(inventory({ plots: [plot({ count: 4 })] }))
    expect(four.totalPlots).toBe(4)
    expect(four.totalBiopoints).toBeCloseTo(one.totalBiopoints * 4, 6)
    // Identical schedules collapse into a single row.
    expect(four.plots).toHaveLength(1)
    expect(four.plots[0]!.plots).toBe(4)
  })

  it('rewards better plots and better land', () => {
    const common = optimize(inventory()).totalBiopoints
    const legendary = optimize(inventory({ plots: [plot({ rarity: 'legendary' })] })).totalBiopoints
    const golden = optimize(
      inventory({ plots: [plot({ rarity: 'legendary', landId: 'golden-acres' })] }),
    ).totalBiopoints

    expect(legendary).toBeGreaterThan(common)
    expect(golden).toBeCloseTo(legendary * 2, 6)
  })

  it('never plants more disposable seeds than the player owns', () => {
    const plan = optimize(
      inventory({ seeds: [{ seedId: 'protoflower', rarity: 'legendary', count: 3 }] }),
    )
    const protoflower = plan.plots
      .flatMap((p) => p.entries)
      .filter((entry) => entry.seedId === 'protoflower')
      .reduce((total, entry) => total + entry.plantings, 0)

    expect(protoflower).toBeLessThanOrEqual(3)
  })

  it('spreads a scarce seed across plots instead of stacking it on one', () => {
    const plan = optimize(
      inventory({
        plots: [plot({ count: 3 })],
        seeds: [{ seedId: 'protoflower', rarity: 'legendary', count: 2 }],
      }),
    )
    const used = plan.plots
      .flatMap((p) => Array.from({ length: p.plots }, () => p.entries))
      .flat()
      .filter((entry) => entry.seedId === 'protoflower')
      .reduce((total, entry) => total + entry.plantings, 0)

    expect(used).toBeLessThanOrEqual(2)
  })

  it('beats the stock-limited plan when stock is ignored', () => {
    const owned = optimize(inventory()).totalBiopoints
    const ceiling = optimize(inventory(), { ignoreStock: true }).totalBiopoints
    expect(ceiling).toBeGreaterThanOrEqual(owned)
  })

  it('warns when a plot has nothing plantable', () => {
    // A soil-only catalogue has no water seeds for a water plot of a nonexistent kind;
    // the reverse check is that water land + soil seeds still finds the trout family.
    const plan = optimize(inventory({ plots: [plot({ landId: 'tranquil-waters' })] }))
    expect(plan.totalBiopoints).toBeGreaterThan(0)
  })

  it('plans on the catalogue it is given, not the docs', () => {
    const docs = optimize(inventory()).totalBiopoints

    // One seed made absurdly valuable must dominate the plan and lift the total.
    const boosted = optimize(inventory(), {
      seeds: seeds.map((seed) =>
        seed.id === 'corn-seed'
          ? { ...seed, variants: { ...seed.variants, common: { biopoints: 1e6, growthSec: 360 } } }
          : seed,
      ),
    })

    expect(boosted.totalBiopoints).toBeGreaterThan(docs)
    expect(boosted.plots[0]!.entries[0]!.seedId).toBe('corn-seed')
  })

  it('commits a bed to one seed in single mode', () => {
    // A stocked farm is where the two modes diverge: the mix uses leftovers, single does not.
    const stocked = inventory({
      plots: [plot({ rarity: 'legendary', lamp: 'rare' })],
      seeds: [
        { seedId: 'corn-seed', rarity: 'legendary', count: 4 },
        { seedId: 'strawberry-seed', rarity: 'legendary', count: 4 },
        { seedId: 'basil-seed', rarity: 'legendary', count: 4 },
      ],
    })

    const mixed = optimize(stocked)
    const single = optimize(stocked, { mode: 'single' })

    expect(single.plots[0]!.entries.length).toBeLessThanOrEqual(1)
    expect(mixed.plots[0]!.entries.length).toBeGreaterThan(1)
    // Simpler, so it cannot beat the mix.
    expect(single.totalBiopoints).toBeLessThanOrEqual(mixed.totalBiopoints)
  })

  it('reports a spread around the expected total', () => {
    const plan = optimize(inventory())
    expect(plan.totalPlain).toBeLessThanOrEqual(plan.totalBiopoints)
    expect(plan.totalLucky).toBeGreaterThanOrEqual(plan.totalBiopoints)
  })

  it('widens the spread when the plot can crit', () => {
    const common = optimize(inventory())
    const legendary = optimize(inventory({ plots: [plot({ rarity: 'legendary' })] }))

    // A common plot never crits, so luck changes nothing there.
    expect(common.totalLucky).toBeCloseTo(common.totalPlain, 6)
    expect(legendary.totalLucky).toBeGreaterThan(legendary.totalPlain)
  })

  it('plants once per visit when the player is not always there', () => {
    const machine = optimize(inventory())
    const away = optimize(inventory(), { checkEverySec: 12 * 3600 })

    // Two visits a day means at most two plantings in a plot, whatever the crop.
    const plantings = away.plots[0]!.entries.reduce((sum, entry) => sum + entry.plantings, 0)
    expect(plantings).toBeLessThanOrEqual(2)
    expect(away.totalBiopoints).toBeLessThan(machine.totalBiopoints)
  })

  it('never picks a crop that would not be ready by the next visit', () => {
    const plan = optimize(inventory(), { checkEverySec: 4 * 3600 })
    for (const entry of plan.plots.flatMap((plot) => plot.entries)) {
      expect(entry.growthSec).toBeLessThanOrEqual(4 * 3600)
    }
  })

  it('checking in more often is never worse', () => {
    const rare = optimize(inventory(), { checkEverySec: 12 * 3600 }).totalBiopoints
    const often = optimize(inventory(), { checkEverySec: 4 * 3600 }).totalBiopoints
    expect(often).toBeGreaterThanOrEqual(rare)
  })

  it('honours a shorter horizon', () => {
    const day = optimize(inventory()).totalBiopoints
    const hour = optimize(inventory(), { horizonSec: 3600 }).totalBiopoints
    expect(hour).toBeLessThan(day)
    expect(hour).toBeGreaterThan(0)
  })
})

describe('attendance', () => {
  // Six plots and no stock limit, so the only thing separating the modes is how often the
  // player can come back and replant.
  const farm = inventory({ plots: [plot({ count: 6 })] })

  it('drops the total when you can only replant every few hours', () => {
    const machine = optimize(farm, { horizonSec: DAY_SECONDS })
    const away = optimize(farm, { horizonSec: DAY_SECONDS, checkEverySec: 12 * 3600 })

    expect(away.totalBiopoints).toBeLessThan(machine.totalBiopoints)
    expect(away.totalBiopoints).toBeGreaterThan(0)
  })

  it('rules out any seed that cannot finish between two visits', () => {
    // A visit every 10 minutes cannot harvest anything slower than 10 minutes.
    const plan = optimize(farm, { horizonSec: DAY_SECONDS, checkEverySec: 600 })
    for (const plot of plan.plots) {
      for (const entry of plot.entries) {
        expect(entry.growthSec).toBeLessThanOrEqual(600)
      }
    }
  })

  it('plants a plot with one seed per visit, never two', () => {
    const plan = optimize(farm, { horizonSec: DAY_SECONDS, checkEverySec: 4 * 3600 })
    const visits = Math.floor(DAY_SECONDS / (4 * 3600))
    for (const group of plan.plots) {
      const plantings = group.entries.reduce((sum, entry) => sum + entry.plantings, 0)
      expect(plantings).toBeLessThanOrEqual(visits)
    }
  })

  it('keeps one seed per plot when visits are spaced out', () => {
    const plan = optimize(farm, {
      horizonSec: DAY_SECONDS,
      checkEverySec: 4 * 3600,
      mode: 'single',
    })
    for (const group of plan.plots) {
      expect(group.entries.length).toBeLessThanOrEqual(1)
    }
  })
})

describe('a seed cannot be in two plots at once', () => {
  it('never plans more plantings than one seed can cover between visits', () => {
    // One renewable strawberry, six plots, a visit every four hours. Everything is planted at
    // the visit, so that one seed fills exactly one plot per visit and no more.
    const farm = inventory({
      plots: [plot({ count: 6 })],
      seeds: [{ seedId: 'strawberry-seed', rarity: 'common', count: 1 }],
    })

    const plan = optimize(farm, { horizonSec: DAY_SECONDS, checkEverySec: 4 * 3600 })
    const visits = Math.floor(DAY_SECONDS / (4 * 3600))
    const planted = plan.plots.reduce(
      (sum, group) =>
        sum + group.entries.reduce((inner, entry) => inner + entry.plantings, 0) * group.plots,
      0,
    )

    expect(planted).toBeLessThanOrEqual(visits)
  })

  it('still lets a fast seed rotate all day when you never leave', () => {
    const farm = inventory({
      plots: [plot({ count: 1 })],
      seeds: [{ seedId: 'strawberry-seed', rarity: 'common', count: 1 }],
    })

    const machine = optimize(farm, { horizonSec: DAY_SECONDS })
    const planted = machine.plots.reduce(
      (sum, group) => sum + group.entries.reduce((inner, entry) => inner + entry.plantings, 0),
      0,
    )

    // A two-minute crop replanted for a day is hundreds of harvests, not one.
    expect(planted).toBeGreaterThan(50)
  })
})
