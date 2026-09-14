import { emptyInventory } from './inventory'
import { optimize } from './optimizer'
import type {
  Garden,
  GardenDevice,
  Inventory,
  LampRarity,
  PlotGroup,
  Rarity,
  Seed,
  Tile,
} from './types'
import { RARITIES } from './types'

/**
 * Where the lamps should go.
 *
 * Beds cannot be moved without rebuilding the farm, but lamps can, and one lamp lights a whole
 * rectangle of tiles — often several beds at once. That is exactly why placement matters and
 * why a lamp cannot be reasoned about one bed at a time.
 *
 * So each lamp keeps its real footprint, every position on the land is tried, and the position
 * that adds the most biopoints across every bed it would cover wins. Strongest lamp first: it
 * has the most to gain from the best spot.
 *
 * Beds are valued on renewable seeds alone. Scarce one-shot seeds couple the beds together,
 * which would make the comparison depend on allocation order rather than on the lamp.
 */
export interface LampPlacement {
  rarity: LampRarity
  /** Top-left of the lamp's coverage box on the land. */
  x: number
  y: number
  w: number
  h: number
  /** The tiles it actually lights, relative to (x, y). Not every box is filled. */
  offsets: Tile[]
  /**
   * The tiles the lamp itself stands on, relative to (x, y).
   *
   * A lamp can stand on tiles it does not light, so these are allowed to fall outside the
   * coverage box: negative, or past its width. Rounding them into the box would redraw the lamp
   * somewhere it never was. Empty when the capture did not say where the lamp stands.
   */
  stand: Tile[]
}

export interface LampPlan {
  /** bed id -> the lamp that should cover it, or null. */
  assignment: Map<string, LampRarity | null>
  placements: LampPlacement[]
  /** Lamps the plan actually picks up and puts somewhere else. */
  movedLamps: number
  currentBiopoints: number
  bestBiopoints: number
  /** Beds whose lamp changes. */
  moved: number
}

function bedValue(
  cache: Map<string, number>,
  rarity: Rarity,
  lamp: LampRarity | null,
  landId: string,
  horizonSec: number,
  catalogue: Seed[],
  mode: 'mix' | 'single',
  checkEverySec: number,
): number {
  const key = `${rarity}|${lamp ?? 'none'}|${landId}|${mode}|${checkEverySec}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const plan = optimize(
    {
      ...emptyInventory,
      plots: [{ id: 'probe', rarity, landId, lamp, count: 1 }],
    },
    { horizonSec, seeds: catalogue, mode, checkEverySec },
  )

  cache.set(key, plan.totalBiopoints)
  return plan.totalBiopoints
}

/**
 * A lamp's coverage as a SHAPE, not a box.
 *
 * The game's lamps do not light every tile of their bounding rectangle, so treating the box as
 * the coverage marks beds as lit that the real lamp never reaches. Keeping the offsets means a
 * moved lamp lights exactly the tiles it lights today, only somewhere else.
 */
interface Footprint {
  w: number
  h: number
  /** Lit tiles relative to the top-left of the box. */
  offsets: Tile[]
  keys: Set<string>
  /** The tiles the lamp stands on, relative to the same corner. */
  stand: Tile[]
  /** Where that corner is on the land today, so an unmoved lamp can be recognised. */
  x: number
  y: number
}

function footprintOf(device: GardenDevice): Footprint {
  const stood = device.tiles[0]
  const single: Footprint = {
    w: 1,
    h: 1,
    offsets: [{ x: 0, y: 0 }],
    keys: new Set(['0,0']),
    stand: stood ? [{ x: 0, y: 0 }] : [],
    x: stood?.x ?? 0,
    y: stood?.y ?? 0,
  }
  if (device.covered.length === 0) return single

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const tile of device.covered) {
    minX = Math.min(minX, tile.x)
    minY = Math.min(minY, tile.y)
    maxX = Math.max(maxX, tile.x)
    maxY = Math.max(maxY, tile.y)
  }

  const offsets = device.covered.map((tile) => ({ x: tile.x - minX, y: tile.y - minY }))

  return {
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    offsets,
    keys: new Set(offsets.map((tile) => `${tile.x},${tile.y}`)),
    x: minX,
    y: minY,
    // The real standing tiles, even when they sit outside the coverage box: a lamp that lights
    // the beds around it is usually not on a lit tile itself, and clamping it into the box made
    // the ideal view redraw an unmoved lamp one tile away. No stand is invented when the
    // capture has none.
    stand: device.tiles.map((tile) => ({ x: tile.x - minX, y: tile.y - minY })),
  }
}

function coversBed(tiles: Tile[], x: number, y: number, print: Footprint): boolean {
  return tiles.some((tile) => print.keys.has(`${tile.x - x},${tile.y - y}`))
}

/**
 * Whether the lamp can stand with its box's top-left at (x, y).
 *
 * A lamp is an object on the land like a plot or a pen, so it needs free tiles to stand on.
 * Scoring positions on light alone put suggested lamps on top of the very plots they were
 * meant to light, a spot the game will never accept.
 */
function canStand(
  garden: Garden,
  occupied: Set<string>,
  print: Footprint,
  x: number,
  y: number,
): boolean {
  return print.stand.every((tile) => {
    const tx = x + tile.x
    const ty = y + tile.y
    const onLand = tx >= 0 && ty >= 0 && tx < garden.width && ty < garden.height
    return onLand && !occupied.has(`${tx},${ty}`)
  })
}

type SoilBed = Garden['beds'][number]
type BedValueOf = (rarity: Rarity, lamp: LampRarity | null) => number
interface Spot {
  x: number
  y: number
  gain: number
  here: boolean
}

/** True when the bed already has a lamp at least as strong as this one. */
function coveredByStronger(already: LampRarity | null, lamp: GardenDevice): boolean {
  return already !== null && RARITIES.indexOf(already) >= RARITIES.indexOf(lamp.rarity)
}

/** Biopoints a lamp adds with its box's top-left at (x, y). */
function gainAt(
  soil: SoilBed[],
  assignment: Map<string, LampRarity | null>,
  lamp: GardenDevice,
  print: Footprint,
  x: number,
  y: number,
  value: BedValueOf,
): number {
  let gain = 0
  for (const bed of soil) {
    if (!coversBed(bed.tiles, x, y, print)) continue
    const already = assignment.get(bed.id) ?? null
    // A weaker lamp adds nothing to a bed a stronger one already covers.
    if (coveredByStronger(already, lamp)) continue
    gain += value(bed.rarity, lamp.rarity) - value(bed.rarity, already)
  }
  return gain
}

/**
 * The position on the land where a lamp adds the most, among the ones it can stand in.
 *
 * With nowhere free to stand, the lamp stays where it is today: that spot is the game's own.
 */
function bestSpot(
  garden: Garden,
  soil: SoilBed[],
  occupied: Set<string>,
  assignment: Map<string, LampRarity | null>,
  lamp: GardenDevice,
  print: Footprint,
  value: BedValueOf,
): Spot {
  let best: Spot | null = null

  /*
    Several positions often light the very same beds: a lamp wider than the beds under it can
    sit a tile either way for the same gain. Taking the first of them moved lamps that were
    already right, which reads as the tool asking for work worth nothing. So a tie is settled
    in favour of where the lamp stands today.
  */
  const TIE = 1e-6
  for (let y = 0; y + print.h <= garden.height; y++) {
    for (let x = 0; x + print.w <= garden.width; x++) {
      if (!canStand(garden, occupied, print, x, y)) continue
      const gain = gainAt(soil, assignment, lamp, print, x, y, value)
      const here = x === print.x && y === print.y
      if (best === null || gain > best.gain + TIE || (here && gain >= best.gain - TIE)) {
        best = { x, y, gain, here }
      }
    }
  }
  return (
    best ?? {
      x: print.x,
      y: print.y,
      gain: gainAt(soil, assignment, lamp, print, print.x, print.y, value),
      here: true,
    }
  )
}

/** Records the lamp on every bed it lights that no stronger lamp already covers. */
function lightBeds(
  soil: SoilBed[],
  assignment: Map<string, LampRarity | null>,
  lamp: GardenDevice,
  print: Footprint,
  x: number,
  y: number,
): void {
  for (const bed of soil) {
    if (!coversBed(bed.tiles, x, y, print)) continue
    const already = assignment.get(bed.id) ?? null
    if (coveredByStronger(already, lamp)) continue
    assignment.set(bed.id, lamp.rarity)
  }
}

export function planLamps(
  garden: Garden,
  horizonSec: number,
  catalogue: Seed[],
  mode: 'mix' | 'single' = 'mix',
  checkEverySec = 0,
): LampPlan {
  const cache = new Map<string, number>()
  const value = (rarity: Rarity, lamp: LampRarity | null) =>
    bedValue(cache, rarity, lamp, garden.landId, horizonSec, catalogue, mode, checkEverySec)

  const lamps = [...garden.devices].sort(
    (a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity),
  )

  const assignment = new Map<string, LampRarity | null>()
  // Lamps do nothing for animals, so they play no part in where lamps should go.
  const soil = garden.beds.filter((bed) => !bed.isAnimal)
  for (const bed of soil) assignment.set(bed.id, null)

  const placements: LampPlacement[] = []

  // Every plot and pen takes up its tiles; each lamp placed takes up its own on top.
  const occupied = new Set(
    garden.beds.flatMap((bed) => bed.tiles.map((tile) => `${tile.x},${tile.y}`)),
  )

  let movedLamps = 0

  for (const lamp of lamps) {
    const print = footprintOf(lamp)
    const { w, h } = print
    const best = bestSpot(garden, soil, occupied, assignment, lamp, print, value)

    if (!best.here) movedLamps += 1
    placements.push({
      rarity: lamp.rarity,
      x: best.x,
      y: best.y,
      w,
      h,
      offsets: print.offsets,
      stand: print.stand,
    })

    for (const tile of print.stand) occupied.add(`${best.x + tile.x},${best.y + tile.y}`)
    lightBeds(soil, assignment, lamp, print, best.x, best.y)
  }

  let currentBiopoints = 0
  let bestBiopoints = 0
  let moved = 0

  for (const bed of soil) {
    const suggested = assignment.get(bed.id) ?? null
    currentBiopoints += value(bed.rarity, bed.lamp)
    bestBiopoints += value(bed.rarity, suggested)
    if (suggested !== bed.lamp) moved += 1
  }

  return { assignment, placements, currentBiopoints, bestBiopoints, moved, movedLamps }
}

/** The same garden with the lamps where they should be, for planning and drawing. */
export function applyLampPlan(garden: Garden, lampPlan: LampPlan): Garden {
  // Only positions whose stand is on free land are chosen, so the tiles need no clamping.
  const devices: GardenDevice[] = lampPlan.placements.map((placement, index) => ({
    id: `suggested-${index}`,
    code: `${placement.rarity}_lamp_device`,
    rarity: placement.rarity,
    tiles: placement.stand.map((tile) => ({
      x: placement.x + tile.x,
      y: placement.y + tile.y,
    })),
    covered: placement.offsets.map((tile) => ({
      x: placement.x + tile.x,
      y: placement.y + tile.y,
    })),
  }))

  return {
    ...garden,
    devices,
    beds: garden.beds.map((bed) => ({
      ...bed,
      lamp: lampPlan.assignment.get(bed.id) ?? null,
    })),
  }
}

/** Plot groups for a garden, one per bed, so every bed gets its own schedule. */
export function plotsOf(garden: Garden): PlotGroup[] {
  return garden.beds
    .filter((bed) => !bed.isAnimal)
    .map((bed) => ({
      id: bed.id,
      rarity: bed.rarity,
      landId: garden.landId,
      lamp: bed.lamp,
      count: 1,
    }))
}

/** Swaps one garden's beds into an inventory, leaving seed stock untouched. */
export function inventoryWith(inventory: Inventory, garden: Garden): Inventory {
  const others = inventory.gardens.filter((item) => item.code !== garden.code)
  const gardens = [...others, garden]
  return { ...inventory, gardens, plots: gardens.flatMap(plotsOf) }
}
