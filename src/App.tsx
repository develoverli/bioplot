import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Coins, ListOrdered, PawPrint, PlugZap, Table2 } from 'lucide-react'
import { FarmWorkspace } from './components/FarmWorkspace'
import { FreshCapture } from './components/FreshCapture'
import { Header } from './components/Header'
import { PlotsCard } from './components/InventoryPanel'
import { SeedsCard } from './components/SeedsCard'
import { SetupDialog } from './components/SetupDialog'
import { FeedPanel } from './components/FeedPanel'
import { PoolsPanel } from './components/PoolsPanel'
import { PlanPanel } from './components/PlanPanel'
import { RankingPanel } from './components/RankingPanel'
import { Button, Card, CheckSwitch, Field, Modal, Select } from './components/ui'
import { game, seedsData } from './lib/catalog'
import { ATTENDANCE_MODES, attendanceSec } from './lib/attendance'
import { buildEffectiveSeeds } from './lib/effective'
import { CONTACT_URL, EXTENSION_URL, PRIVACY_URL, TERMS_URL } from './lib/links'
import { optimize } from './lib/optimizer'
import { useStore } from './store'

const HORIZON_OPTIONS = [4, 8, 12, 24, 48]

function SettingsCard() {
  const horizonHours = useStore((state) => state.horizonHours)
  const setHorizonHours = useStore((state) => state.setHorizonHours)
  const ignoreStock = useStore((state) => state.ignoreStock)
  const setIgnoreStock = useStore((state) => state.setIgnoreStock)
  const plantingMode = useStore((state) => state.plantingMode)
  const setPlantingMode = useStore((state) => state.setPlantingMode)
  const attendance = useStore((state) => state.attendance)
  const setAttendance = useStore((state) => state.setAttendance)

  return (
    <Card title="Planning window">
      <Field label="Horizon" hint="Reward pools pay out every 4 hours; a full day is 6 cycles.">
        {(id) => (
          <Select
            id={id}
            value={horizonHours}
            onChange={(event) => setHorizonHours(Number(event.target.value))}
          >
            {HORIZON_OPTIONS.map((hours) => (
              <option key={hours} value={hours}>
                {hours} hours
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="mt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-faint">How often you play</p>
        <div className="mt-1.5 flex flex-col gap-1">
          {ATTENDANCE_MODES.map((entry) => (
            <CheckSwitch
              key={entry.id}
              checked={attendance === entry.id}
              onChange={() => setAttendance(entry.id)}
              label={entry.label}
              hint={entry.hint}
            />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <CheckSwitch
          checked={plantingMode === 'single'}
          onChange={(value) => setPlantingMode(value ? 'single' : 'mix')}
          label="One seed per plot"
          hint="Plant it and forget it, instead of a mix of several."
        />
        <CheckSwitch
          checked={ignoreStock}
          onChange={setIgnoreStock}
          label="Ignore what I own"
          hint="Plan as if every seed were available."
        />
      </div>
    </Card>
  )
}

export default function App() {
  const theme = useStore((state) => state.theme)
  const inventory = useStore((state) => state.inventory)
  const horizonHours = useStore((state) => state.horizonHours)
  const ignoreStock = useStore((state) => state.ignoreStock)

  const [showSchedule, setShowSchedule] = useState(false)
  const [showRanking, setShowRanking] = useState(false)
  const [showAnimals, setShowAnimals] = useState(false)
  const [showPools, setShowPools] = useState(false)

  const hungry = inventory.gardens.reduce(
    (sum, garden) =>
      sum + garden.beds.filter((bed) => bed.isAnimal && !bed.plantedSeedCode).length,
    0,
  )

  /**
   * The four reference tables, as one row of doors.
   *
   * Each is a table you consult, not a step you follow, so none of them earns permanent space
   * next to the farm. The counts on the labels are what make a closed door worth opening.
   */
  const ReferenceButtons = () => (
    <>
      <Button aria-haspopup="dialog" onClick={() => setShowSchedule(true)}>
        <Table2 size={15} aria-hidden="true" />
        Full schedule
      </Button>
      <Button aria-haspopup="dialog" onClick={() => setShowRanking(true)}>
        <ListOrdered size={15} aria-hidden="true" />
        Seed ranking
      </Button>
      <Button aria-haspopup="dialog" onClick={() => setShowAnimals(true)}>
        <PawPrint size={15} aria-hidden="true" />
        Animals and feed
        {hungry > 0 ? (
          <span className="tabular rounded-full bg-[color:var(--warning)]/15 px-1.5 text-xs font-semibold text-[color:var(--warning)]">
            {hungry} hungry
          </span>
        ) : null}
      </Button>
      <Button aria-haspopup="dialog" onClick={() => setShowPools(true)}>
        <Coins size={15} aria-hidden="true" />
        Reward pools
        {inventory.pools.blocks.length > 0 ? (
          <span className="tabular rounded-full bg-surface-3 px-1.5 text-xs font-semibold text-muted">
            {inventory.pools.blocks.length} live
          </span>
        ) : null}
      </Button>
    </>
  )
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  const catalogue = useStore((state) => state.catalogue)
  const disabledSeeds = useStore((state) => state.disabledSeeds)
  const effective = useMemo(() => buildEffectiveSeeds(catalogue), [catalogue])
  const disabled = useMemo(() => new Set(disabledSeeds), [disabledSeeds])
  const plantingMode = useStore((state) => state.plantingMode)
  const attendance = useStore((state) => state.attendance)
  const horizonSec = horizonHours * 3600

  // The knapsack is cheap but not free; keep typing responsive while it catches up.
  const deferredInventory = useDeferredValue(inventory)
  const stale = deferredInventory !== inventory
  const plan = useMemo(
    () =>
      optimize(deferredInventory, {
        horizonSec,
        ignoreStock,
        seeds: effective.seeds,
        disabled,
        mode: plantingMode,
        checkEverySec: attendanceSec(attendance),
      }),
    [
      deferredInventory,
      horizonSec,
      ignoreStock,
      effective.seeds,
      disabled,
      plantingMode,
      attendance,
    ],
  )

  const hasFarm = inventory.gardens.length > 0

  return (
    <div className="min-h-dvh bg-bg">
      <Header onOpenSetup={() => setSetupOpen(true)} />
      <SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} />

      <main className="mx-auto flex max-w-[100rem] flex-col gap-5 px-4 py-5 sm:px-6">
        <FreshCapture />

        {/*
          With no farm loaded, nothing else on the page can be acted on, so the one thing that
          can goes first and says what it does.
        */}
        {hasFarm ? null : (
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[color:var(--accent)] bg-accent-dim px-4 py-3.5 text-left transition-colors duration-150 hover:bg-surface-2"
          >
            <PlugZap size={20} aria-hidden="true" className="shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">Connect your farm</span>
              <span className="block text-sm text-muted">
                The extension reads your seeds, plots and animals inside your own browser and
                plans from them. Nothing is sent anywhere.
              </span>
            </span>
            <span className="ml-auto shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-[color:var(--accent-contrast)]">
              Load farm
            </span>
          </button>
        )}

        {hasFarm ? (
          <FarmWorkspace
            gardens={inventory.gardens}
            plan={plan}
            catalogue={effective.seeds}
            stale={stale}
            sidebar={
              <>
                <SettingsCard />
                <SeedsCard />
              </>
            }
            belowField={<ReferenceButtons />}
          />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <PlotsCard />
            <SettingsCard />
            <SeedsCard />
          </div>
        )}

        {/* Without a farm there is no field to hang the doors under, so they go here. */}
        {inventory.gardens.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            <ReferenceButtons />
          </div>
        ) : null}

        {/* Both are reference tables, not part of the flow: they belong behind a door. */}
        <Modal open={showSchedule} onClose={() => setShowSchedule(false)} title="Full schedule" wide>
          <PlanPanel plan={plan} bare />
        </Modal>

        <Modal open={showRanking} onClose={() => setShowRanking(false)} title="Seed ranking" wide>
          <RankingPanel horizonSec={horizonSec} catalogue={effective.seeds} bare />
        </Modal>

        <Modal open={showAnimals} onClose={() => setShowAnimals(false)} title="Animals and feed" wide>
          <FeedPanel bare />
        </Modal>

        <Modal open={showPools} onClose={() => setShowPools(false)} title="Reward pools" wide>
          <PoolsPanel bare />
        </Modal>

      </main>

      <footer className="mt-6 border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[100rem] flex-col gap-2 px-4 py-5 text-xs text-faint sm:px-6">
          <p className="max-w-prose">
            Unofficial community tool, not affiliated with Chainers.{' '}
            {effective.liveVariants > 0 ? (
              <>
                <strong className="text-muted">
                  {effective.liveVariants} of {effective.liveVariants + effective.docVariants}
                </strong>{' '}
                seed variants are planned on the game's own live numbers; the rest fall back to
                the docs extracted on {seedsData.extractedAt}.
              </>
            ) : (
              <>
                Numbers come from the official docs, extracted on {seedsData.extractedAt}:{' '}
                {seedsData.seeds.length} seed families across {game.rarities.length} rarities. Sync
                the extension to plan on the game's live numbers instead.
              </>
            )}{' '}
            Seed art comes from the game's own CDN.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer noopener">
              Privacy
            </a>
            <a href={TERMS_URL} target="_blank" rel="noreferrer noopener">
              Terms
            </a>
            <a href={CONTACT_URL} target="_blank" rel="noreferrer noopener">
              Report a problem
            </a>
            {EXTENSION_URL ? (
              <a href={EXTENSION_URL} target="_blank" rel="noreferrer noopener">
                Get the extension
              </a>
            ) : null}
          </p>
        </div>
      </footer>
    </div>
  )
}
