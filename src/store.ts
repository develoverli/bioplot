import { create } from 'zustand'
import { z } from 'zod'
import { defaultLandId } from './lib/catalog'
import {
  catalogueSchema,
  inventorySchema,
  lampSchema,
  raritySchema,
  starterInventory,
} from './lib/inventory'
import {
  emptyCatalogue,
  type Catalogue,
  type Inventory,
  type LampRarity,
  type PlotGroup,
  type Rarity,
  type SeedStack,
} from './lib/types'

const STORAGE_KEY = 'bioplot:state'
/** What the store was called before the rename. Read once, so nobody loses their farm. */
const LEGACY_STORAGE_KEY = 'chain-proplayer:state'
const STORAGE_VERSION = 1

export type ThemeChoice = 'system' | 'dark' | 'light'

export interface ReferenceContext {
  plotRarity: Rarity
  lamp: LampRarity | null
  landId: string
}

const persistedSchema = z.object({
  version: z.literal(STORAGE_VERSION),
  inventory: inventorySchema,
  catalogue: catalogueSchema.default(emptyCatalogue),
  /** Seed variants switched off by the player, as "seedId:rarity". */
  disabledSeeds: z.array(z.string()).default([]),
  /** 'mix' fills every gap; 'single' commits each bed to one seed for the window. */
  plantingMode: z.enum(['mix', 'single']).default('mix'),
  /** How often the player comes back: 'machine' 24/7, 'hybrid' now and then, 'away' rarely. */
  attendance: z.enum(['machine', 'hybrid', 'away']).default('machine'),
  horizonHours: z.number().min(1).max(168),
  ignoreStock: z.boolean(),
  reference: z.object({
    plotRarity: raritySchema,
    lamp: lampSchema.nullable(),
    landId: z.string(),
  }),
  theme: z.enum(['system', 'dark', 'light']),
  captureSignature: z.string().nullable().default(null),
})

type Persisted = z.infer<typeof persistedSchema>

interface StoreState extends Omit<Persisted, 'version'> {
  setInventory: (inventory: Inventory) => void
  setCatalogue: (catalogue: Catalogue) => void
  toggleSeed: (key: string) => void
  setPlantingMode: (mode: 'mix' | 'single') => void
  setAttendance: (mode: 'machine' | 'hybrid' | 'away') => void
  addPlotGroup: () => void
  updatePlotGroup: (id: string, patch: Partial<PlotGroup>) => void
  removePlotGroup: (id: string) => void
  addSeedStack: (stack: SeedStack) => void
  updateSeedStack: (index: number, patch: Partial<SeedStack>) => void
  removeSeedStack: (index: number) => void
  clearGardens: () => void
  setHorizonHours: (hours: number) => void
  setIgnoreStock: (value: boolean) => void
  setReference: (patch: Partial<ReferenceContext>) => void
  setTheme: (theme: ThemeChoice) => void
  /** What the loaded farm was captured from, so a newer capture can be recognised. */
  captureSignature: string | null
  setCaptureSignature: (signature: string | null) => void
  reset: () => void
}

function defaults(): Omit<Persisted, 'version'> {
  return {
    inventory: starterInventory(),
    catalogue: emptyCatalogue,
    disabledSeeds: [],
    plantingMode: 'mix',
    attendance: 'machine',
    horizonHours: 24,
    ignoreStock: false,
    reference: { plotRarity: 'common', lamp: null, landId: defaultLandId },
    // A farm map, rarity colours and biolume greens were drawn for a dark ground; opening on
    // the light repaint shows the app at its least characteristic. The toggle is one click away.
    theme: 'dark',
    captureSignature: null,
  }
}

function load(): Omit<Persisted, 'version'> {
  if (typeof window === 'undefined') return defaults()
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return defaults()
    const parsed = persistedSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return defaults()
    const rest: Omit<Persisted, 'version'> & { version?: Persisted['version'] } = { ...parsed.data }
    delete rest.version
    return rest
  } catch {
    // A corrupt or unreadable store must never stop the app from opening.
    return defaults()
  }
}

function persist(state: Omit<Persisted, 'version'>): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, ...state } satisfies Persisted),
    )
  } catch {
    // Private windows and blocked site data are fine; the app just forgets.
  }
}

let plotSeq = 0
function nextPlotId(): string {
  plotSeq += 1
  return `plot-${Date.now().toString(36)}-${plotSeq}`
}

export const useStore = create<StoreState>((set, get) => {
  const save = () => {
    const {
      inventory,
      catalogue,
      disabledSeeds,
      plantingMode,
      attendance,
      horizonHours,
      ignoreStock,
      reference,
      theme,
      captureSignature,
    } = get()
    persist({
      inventory,
      catalogue,
      disabledSeeds,
      plantingMode,
      attendance,
      horizonHours,
      ignoreStock,
      reference,
      theme,
      captureSignature,
    })
  }

  const update = (updater: (state: StoreState) => Partial<StoreState>) => {
    set(updater)
    save()
  }

  return {
    ...load(),

    setInventory: (inventory) => update(() => ({ inventory })),

    toggleSeed: (key) =>
      update((state) => ({
        disabledSeeds: state.disabledSeeds.includes(key)
          ? state.disabledSeeds.filter((item) => item !== key)
          : [...state.disabledSeeds, key],
      })),

    // Only replace the catalogue when a capture actually carried one.
    setCatalogue: (catalogue) =>
      update((state) =>
        catalogue.vegetables.length + catalogue.seeds.length + catalogue.beds.length > 0 ? { catalogue } : state,
      ),

    addPlotGroup: () =>
      update((state) => ({
        inventory: {
          ...state.inventory,
          plots: [
            ...state.inventory.plots,
            {
              id: nextPlotId(),
              rarity: 'common',
              landId: defaultLandId,
              lamp: null,
              count: 1,
            },
          ],
        },
      })),

    updatePlotGroup: (id, patch) =>
      update((state) => ({
        inventory: {
          ...state.inventory,
          plots: state.inventory.plots.map((group) =>
            group.id === id ? { ...group, ...patch } : group,
          ),
        },
      })),

    removePlotGroup: (id) =>
      update((state) => ({
        inventory: {
          ...state.inventory,
          plots: state.inventory.plots.filter((group) => group.id !== id),
        },
      })),

    addSeedStack: (stack) =>
      update((state) => {
        const existing = state.inventory.seeds.findIndex(
          (row) => row.seedId === stack.seedId && row.rarity === stack.rarity,
        )
        const seeds = [...state.inventory.seeds]
        if (existing >= 0) {
          const current = seeds.at(existing)!
          seeds.splice(existing, 1, { ...current, count: current.count + stack.count })
        } else {
          seeds.push(stack)
        }
        return { inventory: { ...state.inventory, seeds } }
      }),

    updateSeedStack: (index, patch) =>
      update((state) => ({
        inventory: {
          ...state.inventory,
          seeds: state.inventory.seeds.map((row, i) => (i === index ? { ...row, ...patch } : row)),
        },
      })),

    removeSeedStack: (index) =>
      update((state) => ({
        inventory: {
          ...state.inventory,
          seeds: state.inventory.seeds.filter((_, i) => i !== index),
        },
      })),

    // Drops the imported layout and hands the farm back to the manual editor.
    clearGardens: () =>
      update((state) => ({ inventory: { ...state.inventory, gardens: [] } })),

    setPlantingMode: (plantingMode) => update(() => ({ plantingMode })),
    setAttendance: (attendance) => update(() => ({ attendance })),
    setHorizonHours: (horizonHours) => update(() => ({ horizonHours })),
    setIgnoreStock: (ignoreStock) => update(() => ({ ignoreStock })),
    setReference: (patch) => update((state) => ({ reference: { ...state.reference, ...patch } })),
    setTheme: (theme) => update(() => ({ theme })),
    setCaptureSignature: (captureSignature) => update(() => ({ captureSignature })),
    // Reset clears the farm, not the window it is read in. Light or dark is how the player
    // set up their screen, and taking that away is a second, unasked-for change.
    reset: () => update((state) => ({ ...defaults(), theme: state.theme })),
  }
})
