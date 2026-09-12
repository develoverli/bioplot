const compact = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

/** Big biopoint totals: readable at a glance, exact value goes in the title attribute. */
export function formatBiopoints(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 10_000) return plain.format(Math.round(value))
  return compact.format(value)
}

export function formatExact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return plain.format(Math.round(value))
}

/** Growth times, as a farmer would read them: 4h 30m, 12m, 45s. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return `${total}s`

  // Round to whole minutes FIRST, or 3599s becomes "0h 60m".
  const totalMinutes = Math.round(total / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
