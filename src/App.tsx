import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Coins, LayoutGrid, ListOrdered, PawPrint, PlugZap, Table2 } from 'lucide-react'
import { EmptyHero } from './components/EmptyHero'
import { FarmWorkspace } from './components/FarmWorkspace'
import { FeedPanel } from './components/FeedPanel'
import { FreshCapture } from './components/FreshCapture'
import { Header } from './components/Header'
import { PlotsCard } from './components/InventoryPanel'
import { PlanPanel } from './components/PlanPanel'
import { PoolsPanel } from './components/PoolsPanel'
import { RankingPanel } from './components/RankingPanel'
import { SeedsCard } from './components/SeedsCard'
import { SettingsCard } from './components/SettingsCard'
import { SetupDialog } from './components/SetupDialog'
import { TabPanel, Tabs, type TabItem } from './components/ui'
import { FarmSummary, PickPlotPlaceholder, WorkspaceShell } from './components/WorkspaceShell'
import { game, seedsData } from './lib/catalog'
import { attendanceSec } from './lib/attendance'
import { buildEffectiveSeeds } from './lib/effective'
import { CONTACT_URL, EXTENSION_URL, PRIVACY_URL, TERMS_URL } from './lib/links'
import { optimize } from './lib/optimizer'
import { useStore } from './store'

type Tab = 'farm' | 'schedule' | 'ranking' | 'animals' | 'pools'

const PANEL_CLASS = 'rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-2)]'

export default function App() {
  const theme = useStore((state) => state.theme)
  const inventory = useStore((state) => state.inventory)
  const horizonHours = useStore((state) => state.horizonHours)
  const ignoreStock = useStore((state) => state.ignoreStock)

  const [tab, setTab] = useState<Tab>('farm')
  const [setupOpen, setSetupOpen] = useState(false)
  const [planByHand, setPlanByHand] = useState(false)

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
  const liveNumbers = effective.liveVariants > 0

  const hungry = inventory.gardens.reduce(
    (sum, garden) =>
      sum + garden.beds.filter((bed) => bed.isAnimal && !bed.plantedSeedCode).length,
    0,
  )
  const livePools = inventory.pools.blocks.length

  /**
   * The farm, then the four reference tables, as one row of tabs.
   *
   * Each table is something you consult, not a step you follow, so none of them earns
   * permanent space next to the field. The counts on the labels are what make a closed tab
   * worth opening.
   */
  const tabs: TabItem<Tab>[] = [
    { id: 'farm', label: 'Farm', icon: <LayoutGrid size={15} aria-hidden="true" /> },
    { id: 'schedule', label: 'Schedule', icon: <Table2 size={15} aria-hidden="true" /> },
    { id: 'ranking', label: 'Ranking', icon: <ListOrdered size={15} aria-hidden="true" /> },
    {
      id: 'animals',
      label: 'Animals',
      icon: <PawPrint size={15} aria-hidden="true" />,
      badge: hungry > 0 ? `${hungry} hungry` : undefined,
      badgeTone: 'warning',
    },
    {
      id: 'pools',
      label: 'Pools',
      icon: <Coins size={15} aria-hidden="true" />,
      badge: livePools > 0 ? `${livePools} live` : undefined,
      badgeTone: 'neutral',
    },
  ]

  const toolbar = <Tabs items={tabs} active={tab} onChange={setTab} label="Workspace" />

  // Everything but the farm itself renders the same way, with or without a farm loaded.
  const panel =
    tab === 'schedule' ? (
      <TabPanel id="schedule" className={PANEL_CLASS}>
        <PlanPanel plan={plan} bare />
      </TabPanel>
    ) : tab === 'ranking' ? (
      <TabPanel id="ranking" className={PANEL_CLASS}>
        <RankingPanel horizonSec={horizonSec} catalogue={effective.seeds} bare />
      </TabPanel>
    ) : tab === 'animals' ? (
      <TabPanel id="animals" className={PANEL_CLASS}>
        <FeedPanel bare />
      </TabPanel>
    ) : tab === 'pools' ? (
      <TabPanel id="pools" className={PANEL_CLASS}>
        <PoolsPanel bare />
      </TabPanel>
    ) : null

  const sidebar = (
    <>
      <SettingsCard />
      <SeedsCard />
    </>
  )

  // Manual plot groups only count once the player has opened the editor: before that, the
  // starter groups are a template, not a farm, and summarising them invents a number.
  const manualPlots = planByHand
    ? inventory.plots.reduce((sum, group) => sum + group.count, 0)
    : 0
  const manualLamps = planByHand
    ? inventory.plots.reduce((sum, group) => sum + (group.lamp ? group.count : 0), 0)
    : 0

  return (
    <div className="min-h-dvh bg-bg">
      <Header />
      <SetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} />

      <main className="mx-auto flex max-w-[100rem] flex-col gap-3 px-4 py-4 sm:px-5">
        <FreshCapture />

        {/*
          With no farm loaded, nothing else on the page can be acted on, so the one thing that
          can goes first and says what it does.
        */}
        {hasFarm ? null : (
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[color:var(--accent)] bg-accent-dim px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2"
          >
            <PlugZap size={18} aria-hidden="true" className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="text-sm font-semibold text-ink">Connect your farm. </span>
              <span className="text-sm text-muted">
                The extension reads your seeds, plots and animals inside your own browser.
                Nothing is sent anywhere.
              </span>
            </span>
            <span className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-[color:var(--accent-contrast)]">
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
            liveNumbers={liveNumbers}
            sidebar={sidebar}
            toolbar={toolbar}
            center={panel}
            onOpenSetup={() => setSetupOpen(true)}
          />
        ) : (
          <WorkspaceShell
            sidebar={sidebar}
            aside={
              <>
                <FarmSummary
                  landName={null}
                  plots={manualPlots}
                  animals={0}
                  lamps={manualLamps}
                  biopointsPerDay={planByHand && manualPlots > 0 ? plan.totalBiopoints : null}
                  liveNumbers={liveNumbers}
                  horizonHours={horizonHours}
                  onOpenSetup={() => setSetupOpen(true)}
                />
                <PickPlotPlaceholder hint="Load a farm to see each bed's planting order." />
              </>
            }
          >
            {toolbar}
            {tab === 'farm' ? (
              <TabPanel id="farm" className="flex flex-col gap-3">
                <EmptyHero
                  horizonHours={horizonHours}
                  onLoad={() => setSetupOpen(true)}
                  onPlanByHand={() => setPlanByHand((value) => !value)}
                  planningByHand={planByHand}
                />
                {planByHand ? <PlotsCard /> : null}
              </TabPanel>
            ) : (
              panel
            )}
          </WorkspaceShell>
        )}
      </main>

      <footer className="mt-4 border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-xs text-faint sm:px-5">
          <p className="min-w-0 flex-1 basis-96">
            Unofficial community tool, not affiliated with Chainers.{' '}
            {liveNumbers ? (
              <>
                <strong className="text-muted">
                  {effective.liveVariants} of {effective.liveVariants + effective.docVariants}
                </strong>{' '}
                seed variants use the game's own live numbers; the rest fall back to the docs
                extracted on {seedsData.extractedAt}.
              </>
            ) : (
              <>
                Numbers come from the official docs extracted on {seedsData.extractedAt}:{' '}
                {seedsData.seeds.length} seed families across {game.rarities.length} rarities.
                Sync the extension to plan on live numbers.
              </>
            )}{' '}
            Seed art comes from the game's own CDN.
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
