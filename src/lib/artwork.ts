import { matchSeedId } from './inventory'
import type { Catalogue, Rarity } from './types'

/**
 * Sprites for seeds, taken from the game's own CDN.
 *
 * `/api/farm/data/vegetables` reports a `previewImageURL` per crop, so once the catalogue has
 * been captured the app can draw exactly what the game draws. Nothing is re-hosted: the URL
 * is the game's, and a missing sprite simply falls back to text.
 */
export type IconLookup = (seedId: string, rarity: Rarity) => string | null

const key = (seedId: string, rarity: Rarity) => `${seedId}|${rarity}`

export function buildIconLookup(catalogue: Catalogue): IconLookup {
  const icons = new Map<string, string>()

  // Seeds win over vegetables where both exist: a seed packet reads better in a plot than
  // the grown crop does.
  for (const source of [catalogue.vegetables, catalogue.seeds]) {
    for (const entry of source) {
      if (!entry.image) continue
      const seedId = matchSeedId(entry.name)
      if (!seedId) continue
      icons.set(key(seedId, entry.rarity), entry.image)
    }
  }

  return (seedId, rarity) => icons.get(key(seedId, rarity)) ?? null
}

/**
 * Art by raw item code.
 *
 * Feed and animals are not crops, so they never map onto a seed id — but the game publishes
 * their sprites all the same, under codes like `epic_cattle_food` and `common_cattle`. This
 * lookup is the one that makes an animal pen show a cow instead of a word.
 */
export type CodeIconLookup = (code: string) => string | null

export function buildCodeIconLookup(catalogue: Catalogue): CodeIconLookup {
  const icons = new Map<string, string>()

  for (const entry of [...catalogue.vegetables, ...catalogue.seeds]) {
    if (entry.image) icons.set(entry.code, entry.image)
  }
  for (const bed of [...catalogue.beds, ...catalogue.devices]) {
    if (bed.image) icons.set(bed.code, bed.image)
  }

  return (code) => icons.get(code) ?? null
}

/** How many catalogue rows actually carry art, for reporting after an import. */
export function countArtwork(catalogue: Catalogue): number {
  return [...catalogue.vegetables, ...catalogue.seeds].filter((entry) => entry.image).length
}
