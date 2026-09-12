import type { ReactNode } from 'react'
import { MousePointerClick, PlugZap } from 'lucide-react'
import { formatBiopoints, formatExact } from '../lib/format'
import { Card, IconButton } from './ui'

/**
 * The one layout the app has: inputs on the left, the thing being planned in the middle, the
 * farm's summary and the selected plot on the right. With or without a farm loaded the frame
 * is the same, so the page never rearranges itself the moment data arrives.
 *
 * Below `xl` the middle comes first (you look at the plan), then the aside, then the inputs.
 */
export function WorkspaceShell({
  sidebar,
  aside,
  children,
}: {
  sidebar: ReactNode
  aside: ReactNode
  children: ReactNode
}) {
  return (
    <section
      aria-label="Your farm"
      className="grid items-start gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_18rem]"
    >
      <div className="order-3 flex min-w-0 flex-col gap-3 xl:order-1">{sidebar}</div>
      <div className="order-1 flex min-w-0 flex-col gap-3 xl:order-2">{children}</div>
      <div className="order-2 flex min-w-0 flex-col gap-3 xl:order-3">{aside}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="tabular m-0 text-sm text-ink">{children}</dd>
    </div>
  )
}

/**
 * The farm in four lines and one number.
 *
 * Everything here is also visible somewhere else on the page; this is the place a player
 * glances at to know which land they are looking at and what the day is worth, before
 * reading any of it.
 */
export function FarmSummary({
  landName,
  plots,
  animals,
  lamps,
  biopointsPerDay,
  otherPerDay = null,
  ideal = false,
  liveNumbers,
  horizonHours,
  onOpenSetup,
}: {
  landName: string | null
  plots: number
  animals: number
  lamps: number
  /** The view being shown. Null while there is nothing to plan. */
  biopointsPerDay: number | null
  /** The other view (Now under Ideal, Ideal under Now), so both are always on the page. */
  otherPerDay?: number | null
  ideal?: boolean
  liveNumbers: boolean
  horizonHours: number
  /** Opens the load / sync / export / reset dialog. */
  onOpenSetup: () => void
}) {
  const loaded = landName !== null

  return (
    <Card
      title="Farm"
      actions={
        <IconButton label={loaded ? 'Sync, export or reset the farm' : 'Load your farm'} onClick={onOpenSetup}>
          <PlugZap size={16} aria-hidden="true" />
        </IconButton>
      }
    >
      <dl className="m-0 divide-y divide-[color:var(--border)]">
        <Row label="Land">{loaded ? landName : <span className="text-faint">—</span>}</Row>
        <Row label="Plots">{plots}</Row>
        <Row label="Animals">{animals}</Row>
        <Row label="Lamps">{lamps}</Row>
      </dl>

      <div className="mt-2.5 rounded-lg bg-accent-dim px-3 py-2">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">
          {ideal ? 'Ideal' : 'Now'} · {horizonHours}h
        </p>
        {biopointsPerDay === null ? (
          <p className="mt-0.5 text-sm text-muted">No farm loaded</p>
        ) : (
          <p className="mt-0.5 flex items-baseline gap-1.5" title={formatExact(biopointsPerDay)}>
            <span className="tabular text-2xl leading-none font-semibold text-accent">
              {formatBiopoints(biopointsPerDay)}
            </span>
            <span className="text-xs text-muted">bp / day</span>
          </p>
        )}
        {otherPerDay !== null && biopointsPerDay !== null ? (
          <p className="tabular mt-1 text-xs text-muted" title={formatExact(otherPerDay)}>
            {ideal ? 'Now' : 'Ideal'}{' '}
            <span className="font-semibold text-ink">{formatBiopoints(otherPerDay)}</span>
            {otherPerDay !== biopointsPerDay ? (
              <span className="text-faint">
                {' '}
                ({biopointsPerDay > otherPerDay ? '+' : '-'}
                {formatBiopoints(Math.abs(biopointsPerDay - otherPerDay))})
              </span>
            ) : null}
          </p>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-faint">
        {liveNumbers ? "Planned on the game's live numbers." : 'Planned on the official docs.'}
      </p>
    </Card>
  )
}

/** The aside's resting state: a plot has to be picked before there is anything to show. */
export function PickPlotPlaceholder({ hint }: { hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-7 text-center">
      <span className="mx-auto flex size-9 items-center justify-center rounded-lg border border-dashed border-line-strong text-faint">
        <MousePointerClick size={16} aria-hidden="true" />
      </span>
      <p className="mt-2.5 text-sm font-medium text-ink">Pick a plot</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  )
}
