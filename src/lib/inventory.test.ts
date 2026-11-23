import { describe, expect, it } from 'vitest'
import { fromImportPayload, importPayloadSchema, isModelledLamp, splitLampCode } from './inventory'

/** A lamp that lights exactly the tiles given, standing off to the side. */
function lamp(id: string, code: string, rarity: string, covered: Array<[number, number]>) {
  return {
    id,
    code,
    rarity,
    tiles: [{ x: 9, y: 9 }],
    covered: covered.map(([x, y]) => ({ x, y })),
  }
}

function bed(id: string, x: number, lampRarity: string | null) {
  return {
    id,
    rarity: 'rare',
    kind: 'pool_plot',
    isAnimal: false,
    tiles: [{ x, y: 0 }],
    // What the extension sends: the strongest rarity in reach, with no family.
    lamp: lampRarity,
    plantedSeedCode: null,
  }
}

/** The shape of a Tranquil Waters capture: three pool plots, two aqualamps, one phytolamp. */
function payload() {
  return {
    version: 1,
    source: 'test',
    gardens: [
      {
        code: 'tranquil_waters',
        landId: 'tranquil-waters',
        width: 10,
        height: 10,
        beds: [bed('epic-lit', 0, 'epic'), bed('rare-lit', 1, 'rare'), bed('both', 2, 'epic'), bed('photo', 3, 'rare')],
        devices: [
          lamp('aqua-epic', 'epic_aqualamp', 'epic', [[0, 0], [2, 0]]),
          lamp('aqua-rare', 'rare_aqualamp', 'rare', [[1, 0]]),
          lamp('phyto', 'rare_lamp_device', 'rare', [[2, 0], [3, 0]]),
        ],
      },
    ],
  }
}

function importedBeds() {
  const parsed = importPayloadSchema.parse(payload())
  const garden = fromImportPayload(parsed).inventory.gardens[0]
  return new Map((garden?.beds ?? []).map((b) => [b.id, b]))
}

describe('lamps the model cannot weigh', () => {
  it('accepts a capture with an epic aqualamp instead of rejecting the whole farm', () => {
    expect(importPayloadSchema.safeParse(payload()).success).toBe(true)
  })

  it('plans a bed under a rare aqualamp as unlit, never as a rare phytolamp', () => {
    const beds = importedBeds()
    expect(beds.get('rare-lit')?.lamp).toBeNull()
    expect(beds.get('rare-lit')?.unmodelledLamp).toBe('rare_aqualamp')
    expect(beds.get('epic-lit')?.lamp).toBeNull()
    expect(beds.get('epic-lit')?.unmodelledLamp).toBe('epic_aqualamp')
  })

  it('still counts a phytolamp that is the only lamp on the bed', () => {
    const beds = importedBeds()
    expect(beds.get('photo')?.lamp).toBe('rare')
    expect(beds.get('photo')?.unmodelledLamp).toBeNull()
  })

  it('promises no lamp when a phytolamp and an unmodelled lamp overlap', () => {
    const beds = importedBeds()
    expect(beds.get('both')?.lamp).toBeNull()
    expect(beds.get('both')?.unmodelledLamp).toBe('epic_aqualamp')
  })

  it('knows phytolamps up to rare and nothing else', () => {
    expect(isModelledLamp('rare_lamp_device')).toBe(true)
    expect(isModelledLamp('epic_lamp_device')).toBe(false)
    expect(isModelledLamp('rare_aqualamp')).toBe(false)
    expect(isModelledLamp('legendary_mirror_lamp')).toBe(false)
  })

  it('names a lamp from its code', () => {
    expect(splitLampCode('epic_aqualamp')).toEqual({ rarity: 'epic', name: 'aqualamp' })
    expect(splitLampCode('rare_dark_mirror_lamp')).toEqual({ rarity: 'rare', name: 'dark mirror lamp' })
    expect(splitLampCode('uncommon_lamp_device')).toEqual({ rarity: 'uncommon', name: 'phytolamp' })
  })
})
