import { Coins, Lightbulb, PawPrint, PlugZap, Sprout } from 'lucide-react'
import { Button } from './ui'
import { Logo } from './Logo'

const FEATURES = [
  { Icon: Sprout, title: 'Plan every plot', text: 'The best seed per bed for the next day, from what you own.' },
  { Icon: Lightbulb, title: 'Place lamps', text: 'Where each phytolamp is worth most, tile by tile.' },
  { Icon: PawPrint, title: 'Feed animals', text: 'Every feed recipe and which seed is missing.' },
  { Icon: Coins, title: 'Value biopoints', text: 'Your share of each live pool and what it pays.' },
] as const

/**
 * The centre of the page before a farm exists.
 *
 * It says what the tool will do once fed, and offers both doors: the extension for the usual
 * case, manual entry for anyone who will not install anything. Neither is hidden behind the
 * other.
 */
export function EmptyHero({
  horizonHours,
  onLoad,
  onPlanByHand,
  planningByHand,
}: {
  horizonHours: number
  onLoad: () => void
  onPlanByHand: () => void
  planningByHand: boolean
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-8 text-center shadow-[var(--shadow-2)] sm:px-8">
      <Logo size={56} className="mx-auto rounded-[0.85rem]" />
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">Your farm is not loaded yet</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
        The extension reads your plots, seeds and animals inside your own browser, and this page
        plans the next {horizonHours} hours from them. Nothing is sent anywhere.
      </p>

      <ul className="mx-auto mt-6 grid max-w-2xl grid-cols-2 gap-2 text-left sm:grid-cols-4">
        {FEATURES.map(({ Icon, title, text }) => (
          <li key={title} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
            <Icon size={16} aria-hidden="true" className="text-accent" />
            <p className="mt-1.5 text-sm font-medium text-ink">{title}</p>
            <p className="mt-0.5 text-xs text-muted">{text}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col items-center gap-2">
        <Button variant="primary" onClick={onLoad} className="min-w-44">
          <PlugZap size={16} aria-hidden="true" />
          Load farm
        </Button>
        <button
          type="button"
          onClick={onPlanByHand}
          aria-pressed={planningByHand}
          className="rounded-md px-1 text-xs text-muted underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
        >
          {planningByHand ? 'Hide the manual editor' : 'or plan by hand, without the extension'}
        </button>
      </div>
    </div>
  )
}
