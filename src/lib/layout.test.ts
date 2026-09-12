import { describe, expect, it } from 'vitest'
import { seeds } from './catalog'
import { applyLampPlan, planLamps } from './layout'
import type { Garden, GardenBed, GardenDevice } from './types'

function bed(id: string, x: number, y: number): GardenBed {
  return {
    id,
    rarity: 'legendary',
    kind: 'plot',
    isAnimal: false,
    tiles: [{ x, y }],
    lamp: null,
    plantedSeedCode: null,
  }
}

/**
 * A lamp that lights a plus, not a square.
 *
 * Its bounding box is 3×3 but only five tiles are lit, so the four corners of the box are the
 * exact places a box-shaped model would wrongly claim.
 */
function plusLamp(): GardenDevice {
  return {
    id: 'lamp-1',
    code: 'uncommon_lamp_device',
    rarity: 'uncommon',
    tiles: [{ x: 1, y: 1 }],
    covered: [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 2 },
    ],
  }
}

function garden(beds: GardenBed[]): Garden {
  return {
    code: 'garden',
    landId: 'sunny-field',
    width: 3,
    height: 3,
    beds,
    devices: [plusLamp()],
  }
}

describe('planLamps', () => {
  it('never lights a corner the lamp does not reach', () => {
    // Beds on the diagonal sit inside the 3×3 box but outside the plus.
    const field = garden([bed('centre', 1, 1), bed('corner', 0, 0), bed('far', 2, 2)])
    const plan = planLamps(field, 86_400, seeds)

    expect(plan.assignment.get('corner')).toBeNull()
    expect(plan.assignment.get('far')).toBeNull()
  })

  it('lights the beds inside the shape', () => {
    const field = garden([bed('centre', 1, 1), bed('arm', 2, 1), bed('corner', 0, 0)])
    const plan = planLamps(field, 86_400, seeds)

    expect(plan.assignment.get('centre')).toBe('uncommon')
    expect(plan.assignment.get('arm')).toBe('uncommon')
    expect(plan.assignment.get('corner')).toBeNull()
  })

  it('moves the lamp with its shape intact, never as a filled box', () => {
    const field = garden([bed('centre', 1, 1), bed('arm', 1, 2)])
    const plan = planLamps(field, 86_400, seeds)
    const moved = applyLampPlan(field, plan)

    expect(moved.devices[0]!.covered).toHaveLength(5)
    // Every bed the drawing shows as lit is a bed the plan actually assigned.
    const lit = new Set(moved.devices[0]!.covered.map((tile) => `${tile.x},${tile.y}`))
    for (const item of moved.beds) {
      const drawnLit = item.tiles.some((tile) => lit.has(`${tile.x},${tile.y}`))
      expect(drawnLit).toBe(item.lamp !== null)
    }
  })

  it('keeps the lamp standing inside the land', () => {
    const field = garden([bed('centre', 1, 1)])
    const moved = applyLampPlan(field, planLamps(field, 86_400, seeds))
    const stand = moved.devices[0]!.tiles[0]!

    expect(stand.x).toBeGreaterThanOrEqual(0)
    expect(stand.x).toBeLessThan(field.width)
    expect(stand.y).toBeGreaterThanOrEqual(0)
    expect(stand.y).toBeLessThan(field.height)
  })
})

describe('a lamp that stands off its own coverage', () => {
  /** A lamp on the tile above the two beds it lights: its post is outside the lit box. */
  function garden(): Garden {
    return {
      code: 'free_garden',
      landId: 'sunny-field',
      width: 6,
      height: 6,
      beds: [
        bed('a', 1, 2),
        bed('b', 2, 2),
      ],
      devices: [
        {
          id: 'lamp',
          code: 'rare_lamp_device',
          rarity: 'rare',
          tiles: [{ x: 1, y: 1 }],
          covered: [
            { x: 1, y: 2 },
            { x: 2, y: 2 },
          ],
        },
      ],
    }
  }

  it('keeps the post where it stands when the plan leaves the lamp alone', () => {
    const live = garden()
    const plan = planLamps(live, 86_400, seeds)
    const ideal = applyLampPlan(live, plan)
    const drawn = ideal.devices[0]
    expect(drawn?.covered).toEqual(live.devices[0]?.covered)
    // The post used to jump to the middle of the lit box (y 2); it must stay at y 1.
    expect(drawn?.tiles[0]).toEqual({ x: 1, y: 1 })
  })
})

describe('a lamp that is already where it should be', () => {
  /** A lamp three tiles wide over a single bed: three positions light it, all worth the same. */
  function garden(): Garden {
    return {
      code: 'free_garden',
      landId: 'sunny-field',
      width: 8,
      height: 4,
      beds: [bed('a', 2, 1)],
      devices: [
        {
          id: 'lamp',
          code: 'rare_lamp_device',
          rarity: 'rare',
          tiles: [{ x: 2, y: 0 }],
          covered: [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 3, y: 1 },
          ],
        },
      ],
    }
  }

  it('stays put when moving it is worth nothing, and says nothing moved', () => {
    const live = garden()
    const plan = planLamps(live, 86_400, seeds)
    expect(plan.movedLamps).toBe(0)
    const ideal = applyLampPlan(live, plan)
    expect(ideal.devices[0]?.covered).toEqual(live.devices[0]?.covered)
    expect(ideal.devices[0]?.tiles[0]).toEqual({ x: 2, y: 0 })
    // And the bed is still lit by it.
    expect(plan.assignment.get('a')).toBe('rare')
  })

  it('does move it when another spot is worth more', () => {
    const live = garden()
    // A second, better bed out of reach of where the lamp stands now.
    live.beds.push({ ...bed('b', 6, 1), rarity: 'legendary' })
    live.beds[0] = { ...live.beds[0]!, rarity: 'common' }
    const plan = planLamps(live, 86_400, seeds)
    expect(plan.movedLamps).toBe(1)
    expect(plan.assignment.get('b')).toBe('rare')
  })
})
