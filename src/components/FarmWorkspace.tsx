import { useMemo, useState, type ReactNode } from 'react'
import { Check, Leaf, Lightbulb, Lock } from 'lucide-react'
import { buildCodeIconLookup, buildIconLookup } from '../lib/artwork'
import { attendanceSec } from '../lib/attendance'
import { buildFeedReport, type FarmAnimal, type FeedChoice } from '../lib/feed'
import { lands } from '../lib/catalog'
import { formatBiopoints, formatDuration, formatExact, titleCase } from '../lib/format'
import { applyLampPlan, inventoryWith, planLamps } from '../lib/layout'
import { optimize, type Plan, type PlanEntry, type PlotPlan } from '../lib/optimizer'
import type { Garden, Rarity, Seed } from '../lib/types'
import { useStore } from '../store'
import { FarmField } from './FarmField'
import { FeedAdvice } from './FeedAdvice'
import { RarityBadge, TabPanel } from './ui'
import { FarmSummary, PickPlotPlaceholder, WorkspaceShell } from './WorkspaceShell'

const RARITY_VAR: Record<Rarity, string> = {
  common: 'var(--rarity-common)',
  uncommon: 'var(--rarity-uncommon)',
  rare: 'var(--rarity-rare)',
  epic: 'var(--rarity-epic)',
  legendary: 'var(--rarity-legendary)',
}

const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

/** A plan indexed by the bed it is for. */
function byBed(source: Plan | null): Map<string, PlotPlan> {
  const map = new Map<string, PlotPlan>()
  for (const plotPlan of source?.plots ?? []) map.set(plotPlan.groupId, plotPlan)
  return map
}

function LandTabs({
  gardens,
  activeId,
  onPick,
}: {
  gardens: Garden[]
  activeId: string
  onPick: (landId: string) => void
}) {
  return (
    <div role="tablist" aria-label="Your lands" className="flex flex-wrap gap-1.5">
      {lands.map((land) => {
        const owned = gardens.some((garden) => garden.landId === land.id)
        const active = owned && land.id === activeId

        return (
          <button
            key={land.id}
            role="tab"
            type="button"
            aria-selected={active}
            aria-disabled={!owned}
            disabled={!owned}
            onClick={() => onPick(land.id)}
            title={owned ? land.name : `${land.name} — not on your account`}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors duration-150 ${
              active
                ? 'border-[color:var(--accent)] bg-accent-dim text-accent'
                : owned
                  ? 'border-line bg-surface-2 text-ink hover:border-line-strong'
                  : 'border-line bg-surface text-faint'
            }`}
          >
            {owned ? (
              <Leaf size={13} aria-hidden="true" className={active ? '' : 'text-muted'} />
            ) : (
              <Lock size={12} aria-hidden="true" />
            )}
            {land.name}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The schedule for one bed, as a sequence rather than a shopping list.
 *
 * The planner returns a multiset: plant this many of these. Every planting has to finish
 * inside the window, so any order works arithmetically — but a player needs to know what goes
 * in first. Long crops are shown first because they are the ones that will not fit if left
 * until later, and each row carries the clock so the bed can be followed through the day.
 */
function BedSchedule({ entries, horizonSec }: { entries: PlanEntry[]; horizonSec: number }) {
  const catalogue = useStore((state) => state.catalogue)
  const iconFor = useMemo(() => buildIconLookup(catalogue), [catalogue])

  const ordered = useMemo(() => [...entries].sort((a, b) => b.growthSec - a.growthSec), [entries])

  let offset = 0
  const steps = ordered.map((entry) => {
    const span = entry.growthSec * entry.plantings
    const step = { entry, start: offset, span }
    offset += span
    return step
  })
  const used = offset

  return (
    <div>
      {/* One bar for the whole day, so idle time is visible rather than implied. */}
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={`${formatDuration(used)} of ${formatDuration(horizonSec)} planted`}
      >
        {steps.map((step) => (
          <span
            key={`${step.entry.seedId}-${step.entry.rarity}`}
            className="h-full"
            style={{
              width: `${(step.span / horizonSec) * 100}%`,
              background: RARITY_VAR[step.entry.rarity],
            }}
          />
        ))}
      </div>

      <ol className="mt-2.5 flex flex-col gap-1.5">
        {steps.map((step, index) => {
          const { entry } = step
          const icon = iconFor(entry.seedId, entry.rarity)
          return (
            <li
              key={`${entry.seedId}-${entry.rarity}`}
              className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5"
            >
              <span className="tabular w-4 shrink-0 text-center text-xs font-semibold text-faint">
                {index + 1}
              </span>

              {icon ? (
                <img src={icon} alt="" width={28} height={28} loading="lazy" className="size-7" />
              ) : (
                <span
                  aria-hidden="true"
                  className="size-7 rounded border-2"
                  style={{ borderColor: RARITY_VAR[entry.rarity] }}
                />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={entry.seedName}>
                  {/* "Seed" on every row is noise; the column is narrow and the word is implied. */}
                  {entry.seedName.replace(/\s*seeds?$/i, '')}
                  {entry.plantings > 1 ? (
                    <span className="tabular ml-1.5 text-muted">×{entry.plantings}</span>
                  ) : null}
                </p>
                <p className="tabular text-xs text-faint">
                  {step.start === 0 ? 'start now' : `at +${formatDuration(step.start)}`}
                  <span className="mx-1">·</span>
                  {formatDuration(entry.growthSec)} each
                </p>
              </div>

              <RarityBadge rarity={entry.rarity} className="shrink-0" />
            </li>
          )
        })}
      </ol>

      <p className="tabular mt-2 text-xs text-faint">
        {formatDuration(used)} planted, {formatDuration(Math.max(0, horizonSec - used))} idle.
        Order is a suggestion: every planting finishes inside the window, so only the total
        matters.
      </p>
    </div>
  )
}

/**
 * One feed rarity, with the exact reason you can or cannot make it.
 *
 * A recipe's ingredients carry their own rarity, so epic feed is epic produce and nothing else.
 * Holding an epic pea and a rare corn makes neither the epic recipe nor the rare one, and the
 * only way to see that is to show both recipes with what you hold of each ingredient. "You have
 * no feed" hides it; this does not.
 */
function FeedRecipe({ choice, best }: { choice: FeedChoice; best: boolean }) {
  const short = choice.needs.filter((need) => need.owned < need.count)
  const known = choice.needs.length > 0
  // "Ready to craft" with no recipe under it was a promise the capture cannot back. An unknown
  // recipe is unknown, not satisfied.
  const status = choice.owned > 0
    ? `${choice.owned} in your bag`
    : choice.craftable > 0
      ? `craft ${choice.craftable} now`
      : !known
        ? 'recipe not captured'
        : short.length === 0
          ? 'ready to craft'
          : 'cannot make yet'

  return (
    <li
      className={`rounded-lg border px-2.5 py-2 ${
        best ? 'border-[color:var(--accent)] bg-accent-dim' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-center gap-2.5">
        {choice.image ? (
          <img
            src={choice.image}
            alt=""
            width={26}
            height={26}
            className="size-6.5 shrink-0"
            style={choice.owned > 0 || choice.craftable > 0 ? undefined : { filter: 'grayscale(1)', opacity: 0.55 }}
          />
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{choice.name}</span>
          <RarityBadge rarity={choice.rarity} />
        </span>
        <span
          className={`tabular shrink-0 text-xs font-medium ${
            choice.owned > 0 || choice.craftable > 0 ? 'text-accent' : 'text-faint'
          }`}
        >
          {status}
        </span>
      </div>

      {choice.needs.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-xs">
          {choice.needs.map((need) => (
            <li key={need.code} className="tabular flex flex-wrap items-baseline gap-x-2">
              <span className={need.owned >= need.count ? 'text-muted' : 'text-ink'}>
                {need.count}× {need.name}
              </span>
              <span className={need.owned >= need.count ? 'text-faint' : 'text-[color:var(--danger)]'}>
                you have {need.owned}
              </span>
              <span
                className={
                  need.hasSeed
                    ? 'text-accent'
                    : need.owned < need.count
                      ? 'text-[color:var(--danger)]'
                      : 'text-[color:var(--warning)]'
                }
              >
                {need.hasSeed ? `seed owned: ${need.seed}` : `no seed: ${need.seed}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-faint">
          No recipe for this feed in the capture. Reload the farm page in chainers.io, then sync.
        </p>
      )}

      {/* The one sentence that says what to do next, rather than making it be worked out. */}
      {known && short.length > 0 ? (
        <p className="mt-1.5 text-xs text-ink">
          Short{' '}
          {short
            .map((need) => `${need.count - need.owned} ${need.name}`)
            .join(' and ')}
          .{' '}
          {short.every((need) => need.hasSeed)
            ? 'You own the seeds: grow them and this feed is yours.'
            : `Buy ${short
                .filter((need) => !need.hasSeed)
                .map((need) => need.seed)
                .join(' and ')} and it never runs out.`}
        </p>
      ) : null}
    </li>
  )
}

/**
 * Every feed this animal takes, strongest first.
 *
 * Showing only the one you can make answers "what now" and nothing else. Showing the ladder
 * answers "what next": which single ingredient stands between the feed you are making and the
 * better one, at which rarity.
 */
function FeedLadder({ animal }: { animal: FarmAnimal }) {
  if (animal.feeds.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-line bg-surface px-2.5 py-2">
        <p className="text-sm text-muted">
          {animal.feeding ? (
            <>
              This pen eats{' '}
              <span className="font-medium text-ink">
                {animal.feeding.replace(/_/g, ' ')}
              </span>
              , but that feed is not in the captured catalogue, so its recipe cannot be shown.
            </>
          ) : (
            <>No feed for this animal appears anywhere in the capture.</>
          )}
        </p>
        <p className="mt-1 text-xs text-faint">
          Reload the farm page in chainers.io, then sync again. Naming its
          ingredients without the game's recipe would be a guess, and a wrong shopping list is
          worse than none.
        </p>
      </div>
    )
  }

  const preferred = animal.sustainable ?? animal.best ?? animal.obtainable

  return (
    <div className="mt-3">
      <p className="text-xs font-medium tracking-wide text-faint uppercase">
        What it eats, and what each one costs
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {animal.feeds.map((choice) => (
          <FeedRecipe key={choice.code} choice={choice} best={choice.code === preferred?.code} />
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-faint">
        Ingredients must match the feed's rarity. A rarer feed is always worth more.
      </p>
    </div>
  )
}

/** One animal pen: what it is, and precisely what to put in it. */
function SelectedAnimal({ bedId }: { bedId: string }) {
  const inventory = useStore((state) => state.inventory)
  const catalogue = useStore((state) => state.catalogue)
  const report = useMemo(() => buildFeedReport(inventory, catalogue), [inventory, catalogue])
  const animal = report.animals.find((candidate) => candidate.id === bedId)

  if (!animal) return null

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-2.5">
        {animal.image ? (
          <img src={animal.image} alt="" width={40} height={40} className="size-10 shrink-0" />
        ) : null}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{animal.name}</h3>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RarityBadge rarity={animal.rarity} />
            <span className="text-xs text-muted">animal pen</span>
          </div>
        </div>
      </div>

      {animal.feeding ? (
        <p className="mt-2.5 rounded-lg bg-surface px-2.5 py-1.5 text-sm text-ink">
          Growing <span className="font-medium">{animal.feeding.replace(/_/g, ' ')}</span> right
          now. Wait for it before feeding again.
        </p>
      ) : null}

      <FeedAdvice animal={animal} />

      <FeedLadder animal={animal} />
    </div>
  )
}

function SelectedBed({
  garden,
  planByBed,
  selected,
  horizonSec,
}: {
  garden: Garden
  planByBed: Map<string, PlotPlan>
  selected: string | null
  horizonSec: number
}) {
  const bed = garden.beds.find((candidate) => candidate.id === selected) ?? null
  const plotPlan = bed ? planByBed.get(bed.id) : undefined

  if (bed?.isAnimal) return <SelectedAnimal bedId={bed.id} />

  if (!bed || !plotPlan) {
    return <PickPlotPlaceholder hint="Click any plot on the field for its planting order." />
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{titleCase(bed.rarity)} plot</h3>
        <span
          className="tabular text-sm font-semibold text-accent"
          title={formatExact(plotPlan.biopointsPerPlot)}
        >
          {formatBiopoints(plotPlan.biopointsPerPlot)} bp
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <RarityBadge rarity={bed.rarity} />
        <span className="text-xs text-muted">
          {bed.lamp ? `${titleCase(bed.lamp)} lamp` : 'no lamp'}
        </span>
      </div>

      <p className="tabular mt-1 text-xs text-faint">
        {formatBiopoints(plotPlan.biopointsPlain)} – {formatBiopoints(plotPlan.biopointsLucky)}{' '}
        <span className="font-sans">depending on criticals</span>
      </p>

      {bed.plantedSeedCode ? (
        <p className="mt-2 text-xs text-faint">
          Growing right now: {bed.plantedSeedCode.replace(/_/g, ' ')}. Harvest it before following
          this plan.
        </p>
      ) : null}

      <div className="mt-2.5">
        <BedSchedule entries={plotPlan.entries} horizonSec={horizonSec} />
      </div>
    </div>
  )
}

interface Stat {
  label: string
  value: number
  exact?: string
  tone?: 'warning' | 'ink'
}

/**
 * The day's number, and the same number cut four ways beside it.
 *
 * One figure is the answer; the rest are that figure on a lucky day, on a flat one, per hour
 * and per pool. They sit smaller, divided by hairlines, so the hierarchy survives: four equal
 * boxes would say four things are equally important, and they are not.
 */
function StatsStrip({
  headline,
  headlineLabel,
  stats,
  stale,
}: {
  headline: number
  headlineLabel: string
  stats: Stat[]
  stale: boolean
}) {
  return (
    <div className={`mt-3 flex flex-wrap items-stretch gap-2 ${stale ? 'is-stale' : ''}`}>
      <p
        className="flex flex-col justify-center rounded-xl bg-accent-dim px-3.5 py-1.5"
        title={formatExact(headline)}
      >
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">
          {headlineLabel}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="tabular text-2xl leading-none font-semibold text-accent">
            {formatBiopoints(headline)}
          </span>
          <span className="text-xs font-medium text-muted">bp / day</span>
        </span>
      </p>

      {/* Six figures do not fit across a phone; stacked, each one keeps its label beside it. */}
      <dl className="m-0 flex min-w-0 flex-1 flex-col divide-y divide-[color:var(--border)] rounded-xl border border-line md:flex-row md:items-center md:divide-x md:divide-y-0">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex min-w-0 flex-1 items-baseline justify-between gap-2 px-3 py-1.5 md:block"
            title={stat.exact}
          >
            <dt className="truncate text-xs text-faint">{stat.label}</dt>
            <dd
              className={`tabular m-0 text-sm font-semibold ${
                stat.tone === 'warning'
                  ? 'text-[color:var(--warning)]'
                  : stat.tone === 'ink'
                    ? 'text-ink'
                    : 'text-muted'
              }`}
            >
              {formatBiopoints(stat.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * The farm, front and centre: options on the left, field in the middle, the farm's summary and
 * the selected bed's planting order on the right. Everything a player acts on is on one screen.
 */
export function FarmWorkspace({
  gardens,
  plan,
  catalogue: seedCatalogue,
  stale,
  liveNumbers,
  sidebar,
  toolbar,
  center,
  onOpenSetup,
}: {
  gardens: Garden[]
  plan: Plan
  /** The numbers to plan against: live where captured, docs otherwise. */
  catalogue: Seed[]
  stale: boolean
  liveNumbers: boolean
  sidebar: ReactNode
  /** The tab row above the field. */
  toolbar: ReactNode
  /** When another tab is open, what replaces the field. The aside stays put. */
  center: ReactNode | null
  onOpenSetup: () => void
}) {
  const catalogue = useStore((state) => state.catalogue)
  const inventory = useStore((state) => state.inventory)
  const horizonHours = useStore((state) => state.horizonHours)
  const ignoreStock = useStore((state) => state.ignoreStock)
  const plantingMode = useStore((state) => state.plantingMode)
  const attendance = useStore((state) => state.attendance)
  const disabledSeeds = useStore((state) => state.disabledSeeds)
  const disabled = useMemo(() => new Set(disabledSeeds), [disabledSeeds])
  const iconFor = useMemo(() => buildIconLookup(catalogue), [catalogue])
  const iconByCode = useMemo(() => buildCodeIconLookup(catalogue), [catalogue])
  const feedReport = useMemo(() => buildFeedReport(inventory, catalogue), [inventory, catalogue])

  // Every pen's recommended feed, so the field can draw it without redoing the work per plot.
  const feedByPen = useMemo(() => {
    const map = new Map<string, string>()
    for (const animal of feedReport.animals) {
      // Falls through to the plain best-fitting feed so a pen always has a sprite to draw:
      // a greyed-out picture of the food says far more than an empty square with a cross.
      const feed =
        animal.sustainable ?? animal.best ?? animal.obtainable ?? animal.feeds[0] ?? null
      if (feed) map.set(animal.id, feed.code)
    }
    return map
  }, [feedReport])

  /** Pens whose feed is not on hand: the sprite is drawn faded so the state is visible. */
  const feedNotOwned = useMemo(
    () =>
      new Set(
        feedReport.animals
          .filter((animal) => (animal.sustainable ?? animal.best) === null)
          .map((animal) => animal.id),
      ),
    [feedReport],
  )

  /** Pens with no feed at all, owned or craftable. */
  const feedImpossible = useMemo(
    () =>
      new Set(
        feedReport.animals
          .filter((animal) => !animal.sustainable && !animal.best && !animal.obtainable)
          .map((animal) => animal.id),
      ),
    [feedReport],
  )

  const [activeLand, setActiveLand] = useState(gardens[0]?.landId ?? 'sunny-field')
  const [selected, setSelected] = useState<string | null>(null)
  // The ideal layout is the answer the tool exists to give, so it is what opens.
  const [showIdealLayout, setShowIdealLayout] = useState(true)

  const live = gardens.find((item) => item.landId === activeLand) ?? gardens[0]
  const horizonSec = horizonHours * 3600

  const lampPlan = useMemo(
    () =>
      live
        ? planLamps(live, horizonSec, seedCatalogue, plantingMode, attendanceSec(attendance))
        : null,
    [live, horizonSec, seedCatalogue, plantingMode, attendance],
  )

  const idealGarden = useMemo(
    () => (live && lampPlan ? applyLampPlan(live, lampPlan) : null),
    [live, lampPlan],
  )

  const idealPlan = useMemo(
    () =>
      idealGarden
        ? optimize(inventoryWith(inventory, idealGarden), {
            horizonSec,
            ignoreStock,
            seeds: seedCatalogue,
            disabled,
            mode: plantingMode,
            checkEverySec: attendanceSec(attendance),
          })
        : null,
    [
      idealGarden,
      inventory,
      horizonSec,
      ignoreStock,
      seedCatalogue,
      disabled,
      plantingMode,
      attendance,
    ],
  )

  const gain = lampPlan ? lampPlan.bestBiopoints - lampPlan.currentBiopoints : 0
  // Whether moving a lamp is worth anything. The ideal view exists either way: even with the
  // lamps already right, it is the one where every pen runs the best feed you can make.
  const canImprove = gain > 1 && (lampPlan?.moved ?? 0) > 0

  const ideal = showIdealLayout && Boolean(idealGarden && idealPlan)
  const garden = ideal && idealGarden ? idealGarden : live

  // In the ideal view the animals run the best feed you can actually make.
  const animalDay = ideal ? feedReport.idealBiopointsPerDay : feedReport.biopointsPerDay

  const planNow = useMemo(() => byBed(plan), [plan])
  const planIdeal = useMemo(() => byBed(idealPlan), [idealPlan])
  const planByBed = ideal ? planIdeal : planNow

  /**
   * Only the plots that GAIN a lamp.
   *
   * A plot losing its lamp also "changed", but marking it the same way and labelling the
   * marker "move a lamp here" pointed at plots the ideal deliberately leaves dark. The two
   * are opposite instructions and cannot share a border.
   */
  const gainedLamp = useMemo(() => {
    if (!live || !lampPlan) return new Set<string>()
    return new Set(
      live.beds
        .filter((bed) => {
          const next = lampPlan.assignment.get(bed.id) ?? null
          if (next === null || next === bed.lamp) return false
          return bed.lamp === null || RARITY_ORDER.indexOf(next) > RARITY_ORDER.indexOf(bed.lamp)
        })
        .map((bed) => bed.id),
    )
  }, [live, lampPlan])

  if (!garden || !live) return null

  const total = garden.beds.reduce(
    (sum, bed) => sum + (planByBed.get(bed.id)?.biopointsPerPlot ?? 0),
    0,
  )
  // Both views, always: the page never shows one number without the other beside it.
  const nowPerDay =
    live.beds.reduce((sum, bed) => sum + (planNow.get(bed.id)?.biopointsPerPlot ?? 0), 0) +
    feedReport.biopointsPerDay
  const idealPerDay =
    idealGarden && idealPlan
      ? idealGarden.beds.reduce(
          (sum, bed) => sum + (planIdeal.get(bed.id)?.biopointsPerPlot ?? 0),
          0,
        ) + feedReport.idealBiopointsPerDay
      : nowPerDay
  const totalLucky = garden.beds.reduce(
    (sum, bed) => sum + (planByBed.get(bed.id)?.biopointsLucky ?? 0),
    0,
  )
  const totalPlain = garden.beds.reduce(
    (sum, bed) => sum + (planByBed.get(bed.id)?.biopointsPlain ?? 0),
    0,
  )

  // A plot left empty is almost always a seed shortage, not a bug, and the player can only
  // act on it if the page says so.
  const soil = garden.beds.filter((bed) => !bed.isAnimal)
  const animals = garden.beds.filter((bed) => bed.isAnimal)
  const hungry = animals.filter((bed) => !bed.plantedSeedCode).length
  const idleBeds = soil.filter((bed) => (planByBed.get(bed.id)?.entries.length ?? 0) === 0).length
  const landName = lands.find((land) => land.id === garden.landId)?.name ?? garden.landId

  const stats: Stat[] = []
  // Luck is the difference between a flat day and a great one.
  if (totalLucky > totalPlain) {
    stats.push({ label: 'lucky', value: totalLucky, exact: formatExact(totalLucky), tone: 'warning' })
    stats.push({ label: 'flat', value: totalPlain, exact: formatExact(totalPlain) })
  }
  // Crops and animals are two different engines; the farm is the sum.
  if (feedReport.hasOutput) {
    stats.push({ label: 'from plots', value: total, exact: formatExact(total) })
    stats.push({
      label: `from ${animals.length} animal${animals.length === 1 ? '' : 's'}`,
      value: animalDay,
      exact: formatExact(animalDay),
      tone: 'ink',
    })
  }
  stats.push({ label: 'per hour', value: total / (horizonSec / 3600) })
  stats.push({ label: 'per pool', value: total / (horizonSec / 14_400) })

  return (
    <WorkspaceShell
      sidebar={sidebar}
      aside={
        <>
          <FarmSummary
            landName={landName}
            plots={soil.length}
            animals={animals.length}
            lamps={garden.devices.length}
            biopointsPerDay={ideal ? idealPerDay : nowPerDay}
            otherPerDay={ideal ? nowPerDay : idealPerDay}
            ideal={ideal}
            liveNumbers={liveNumbers}
            horizonHours={horizonHours}
            onOpenSetup={onOpenSetup}
          />
          {center ? null : (
            <SelectedBed
              garden={garden}
              planByBed={planByBed}
              selected={selected}
              horizonSec={horizonSec}
            />
          )}
        </>
      }
    >
      {toolbar}

      {center ?? (
        <TabPanel id="farm" className="mx-auto flex w-fit max-w-full min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LandTabs
              gardens={gardens}
              activeId={garden.landId}
              onPick={(landId) => {
                setActiveLand(landId)
                setSelected(null)
              }}
            />

            {idealGarden && idealPlan ? (
              <button
                type="button"
                role="switch"
                aria-checked={ideal}
                onClick={() => setShowIdealLayout(!ideal)}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors duration-150 ${
                  ideal
                    ? 'border-[color:var(--accent)] bg-accent-dim text-accent'
                    : 'border-line bg-surface-2 text-ink hover:border-line-strong'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 ${
                    ideal
                      ? 'border-[color:var(--accent)] bg-accent text-[color:var(--accent-contrast)]'
                      : 'border-line-strong'
                  }`}
                >
                  {ideal ? <Check size={9} strokeWidth={3.5} /> : null}
                </span>
                <Lightbulb size={13} aria-hidden="true" />
                Ideal
                {canImprove ? (
                  <span className="tabular font-medium opacity-80">+{formatBiopoints(gain)}</span>
                ) : null}
              </button>
            ) : null}
          </div>

          <div className="w-full rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-2)]">
            <FarmField
              garden={garden}
              planByBed={planByBed}
              iconFor={iconFor}
              iconByCode={iconByCode}
              feedByPen={feedByPen}
              feedNotOwned={feedNotOwned}
              feedImpossible={feedImpossible}
              selected={selected}
              onSelect={setSelected}
              changedBeds={ideal ? gainedLamp : undefined}
            />

            {/*
              One place for the numbers, right under the thing they describe. The headline is
              the farm, not one half of it: crops and animals are separate engines but a player
              only ever spends the sum.
            */}
            <StatsStrip
              headline={total + animalDay}
              headlineLabel={ideal ? 'Ideal' : 'Now'}
              stats={stats}
              stale={stale}
            />

            <p className="mt-2 text-xs text-muted">
              {ideal ? (
                canImprove ? (
                  <>
                    Lamps shown where they should be. Dashed plots are the ones to move a lamp
                    onto:{' '}
                    <span className="tabular font-semibold text-accent">
                      +{formatBiopoints(gain)}
                    </span>{' '}
                    bp / day. Pens run the best feed you can make. Nothing is changed in your game.
                  </>
                ) : (
                  <>
                    Your lamps are already where they should be. Pens run the best feed you can
                    make; switch to Now for what is actually growing.
                  </>
                )
              ) : canImprove ? (
                <>
                  Your farm as it is. Moving {lampPlan?.placements.length} lamp
                  {lampPlan?.placements.length === 1 ? '' : 's'} and feeding every pen its best is
                  worth{' '}
                  <span className="tabular font-semibold text-accent">
                    +{formatBiopoints(Math.max(0, idealPerDay - nowPerDay))}
                  </span>{' '}
                  bp / day.
                </>
              ) : (
                <>Your farm as it is, with what is growing right now.</>
              )}
            </p>

            {hungry > 0 ? (
              <p className="mt-2 text-xs text-[color:var(--warning)]">
                {hungry} animal{hungry === 1 ? '' : 's'} with nothing growing
                {feedReport.hasOutput &&
                feedReport.idealBiopointsPerDay > feedReport.biopointsPerDay ? (
                  <>
                    . Feeding every pen its best would add{' '}
                    <span className="tabular font-semibold">
                      {formatBiopoints(
                        feedReport.idealBiopointsPerDay - feedReport.biopointsPerDay,
                      )}
                    </span>{' '}
                    bp / day.
                  </>
                ) : (
                  '. Feed is crafted from your harvest; the Animals tab shows what you can make.'
                )}
              </p>
            ) : null}

            {idleBeds > 0 ? (
              <p className="mt-2 text-xs text-[color:var(--warning)]">
                {idleBeds} plot{idleBeds === 1 ? '' : 's'} left empty: you do not own enough seeds
                to fill them. One seed can only grow in one plot at a time.
              </p>
            ) : null}

            <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
              {RARITY_ORDER.map((rarity) => (
                <li key={rarity} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-sm border-2"
                    style={{ borderColor: RARITY_VAR[rarity] }}
                  />
                  {titleCase(rarity)}
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full bg-[color:var(--warning)]"
                />
                Lamp
              </li>
              {animals.length > 0 ? (
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-sm bg-[color:var(--grass-2)]"
                  />
                  Animal
                </li>
              ) : null}
              {ideal ? (
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-sm border-2 border-dashed border-[color:var(--text)]"
                  />
                  Move a lamp here
                </li>
              ) : null}
            </ul>
          </div>
        </TabPanel>
      )}
    </WorkspaceShell>
  )
}
