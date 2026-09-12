import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronRight, X } from 'lucide-react'
import type { Rarity } from '../lib/types'
import { titleCase } from '../lib/format'

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface shadow-[var(--shadow-1)] ${className}`}
    >
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-3.5 py-2.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div className="px-3.5 py-3">{children}</div>
    </section>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-accent text-[color:var(--accent-contrast)] hover:bg-accent-strong active:bg-accent-strong',
  secondary: 'border-line bg-surface-2 text-ink hover:bg-surface-3 active:bg-surface-3',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-3',
  danger:
    'border-line bg-transparent text-[color:var(--danger)] hover:bg-surface-2 active:bg-surface-3',
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors duration-150 ${BUTTON_STYLES[variant]} ${className}`}
    />
  )
}

export function IconButton({
  label,
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`inline-flex size-9 items-center justify-center rounded-lg border border-transparent text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink active:bg-surface-3 ${className}`}
    >
      {children}
    </button>
  )
}

/** IconButton's twin for somewhere to go rather than something to do. */
export function IconLink({
  label,
  href,
  className = '',
  children,
}: {
  label: string
  href: string
  className?: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      title={label}
      className={`inline-flex size-9 items-center justify-center rounded-lg border border-transparent text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink active:bg-surface-3 ${className}`}
    >
      {children}
    </a>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium tracking-wide text-faint uppercase">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  )
}

const CONTROL_CLASS =
  'min-h-9 w-full rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-ink transition-colors duration-150 hover:border-line-strong'

export function Select({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL_CLASS} ${className}`} />
}

export function NumberInput({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type="number"
      inputMode="numeric"
      className={`${CONTROL_CLASS} tabular ${className}`}
    />
  )
}

export function TextInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="text" className={`${CONTROL_CLASS} ${className}`} />
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 shrink-0 accent-[color:var(--accent)]"
      />
      <label htmlFor={id} className="cursor-pointer text-sm text-ink">
        {label}
        {hint ? <span className="mt-0.5 block text-xs text-faint">{hint}</span> : null}
      </label>
    </div>
  )
}

/**
 * A round check that reads as on or off at a glance.
 *
 * The whole app's switches look like this — seeds, planting mode, the ideal layout — so a
 * player learns the shape once and recognises every other switch for free.
 */
export function CheckSwitch({
  checked,
  onChange,
  label,
  hint,
  icon,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors duration-150 ${
        checked
          ? 'border-line bg-surface-2 hover:border-line-strong'
          : 'border-transparent bg-transparent hover:bg-surface-2'
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150 ${
          checked
            ? 'border-[color:var(--accent)] bg-accent text-[color:var(--accent-contrast)]'
            : 'border-line-strong'
        }`}
      >
        {checked ? <Check size={10} strokeWidth={3.5} /> : null}
      </span>

      {icon ? (
        <span className={`shrink-0 ${checked ? 'text-accent' : 'text-faint'}`}>{icon}</span>
      ) : null}

      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${checked ? 'text-ink' : 'text-muted'}`}>{label}</span>
        {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
      </span>
    </button>
  )
}

const RARITY_VAR: Record<Rarity, string> = {
  common: 'var(--rarity-common)',
  uncommon: 'var(--rarity-uncommon)',
  rare: 'var(--rarity-rare)',
  epic: 'var(--rarity-epic)',
  legendary: 'var(--rarity-legendary)',
}

/** Colour plus the word itself: rarity is never communicated by colour alone. */
export function RarityBadge({ rarity, className = '' }: { rarity: Rarity; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${className}`}
      style={{ color: RARITY_VAR[rarity] }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full"
        style={{ background: RARITY_VAR[rarity] }}
      />
      {titleCase(rarity)}
    </span>
  )
}

export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: ReactNode
  /** A count worth opening the tab for: hungry animals, live pools. */
  badge?: ReactNode
  badgeTone?: 'warning' | 'neutral'
}

/**
 * One row of tabs over the workspace: the farm, and the reference tables that hang off it.
 *
 * They used to be modals. A modal for a table the player consults ten times a day is a door
 * they have to keep opening; a tab keeps the sidebar, the aside and the selected plot in place
 * while they look something up.
 */
export function Tabs<T extends string>({
  items,
  active,
  onChange,
  label,
}: {
  items: TabItem<T>[]
  active: T
  onChange: (id: T) => void
  label: string
}) {
  const refs = useRef<Map<T, HTMLButtonElement>>(new Map())

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === active)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    const item = items[next]
    if (!item) return
    onChange(item.id)
    refs.current.get(item.id)?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-1)]"
    >
      {items.map((item) => {
        const selected = item.id === active
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node)
              else refs.current.delete(item.id)
            }}
            role="tab"
            type="button"
            id={`tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150 ${
              selected
                ? 'bg-accent-dim text-accent'
                : 'text-muted hover:bg-surface-2 hover:text-ink'
            }`}
          >
            {item.icon}
            {item.label}
            {item.badge !== undefined && item.badge !== null ? (
              <span
                className={`tabular rounded-full px-1.5 text-xs font-semibold ${
                  item.badgeTone === 'warning'
                    ? 'bg-[color:var(--warning)]/15 text-[color:var(--warning)]'
                    : 'bg-surface-3 text-muted'
                }`}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({
  id,
  children,
  className = '',
}: {
  id: string
  children: ReactNode
  className?: string
}) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} className={className}>
      {children}
    </div>
  )
}

/** Progressive disclosure for the secondary path, so it never has to become a modal. */
export function Disclosure({
  summary,
  children,
}: {
  summary: ReactNode
  children: ReactNode
}) {
  return (
    <details className="group mt-3 rounded-lg border border-line bg-surface-2">
      <summary className="flex min-h-9 list-none items-center gap-2 px-3 text-sm text-muted transition-colors duration-150 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={15}
          aria-hidden="true"
          className="transition-transform duration-150 group-open:rotate-90"
        />
        {summary}
      </summary>
      <div className="border-t border-line px-3 py-3">{children}</div>
    </details>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

/**
 * A panel with its chrome taken off.
 *
 * Inside a tab or a dialog the title already sits above, so a Card here would nest a heading
 * in a heading and a border in a border. Panels take a `bare` flag and swap this in.
 */
export function BareFrame({
  description,
  children,
}: {
  title?: unknown
  description?: ReactNode
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div>
      {description ? <p className="mb-3 text-sm text-muted">{description}</p> : null}
      {children}
    </div>
  )
}

/**
 * The app's only dialog. Native alert/confirm are never used: they break the theme,
 * cannot be styled, and block the page.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** For content that is a table rather than a sentence. */
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const onCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      className={`m-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-[var(--shadow-2)] backdrop:bg-black/60 ${
        wide ? 'w-[min(72rem,calc(100vw-2rem))]' : 'w-[min(34rem,calc(100vw-2rem))]'
      }`}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <IconButton label="Close" onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </IconButton>
      </header>
      <div className="max-h-[75vh] overflow-y-auto scroll-thin px-4 py-3.5">{children}</div>
      {footer ? (
        <footer className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</footer>
      ) : null}
    </dialog>
  )
}
