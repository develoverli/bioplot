import { currencyKey, tokenFor } from './chain'

/**
 * Coin prices, so an amount of BNB and an amount of MATIC can be read side by side.
 *
 * CoinGecko's public price endpoint needs no key and allows browser requests. The request
 * names coin ids and nothing else: no wallet, no account, nothing from the capture. CFB is
 * a token internal to Chainers with no public market, so it has no fetched price; the player
 * may type a reference price for it, and that is the only manual number on the page.
 */
export const PRICE_SOURCE = {
  name: 'CoinGecko',
  url: 'https://api.coingecko.com/api/v3/simple/price',
  /** Currency key → CoinGecko id. MATIC migrated to POL one to one; POL is the live market. */
  ids: { BNB: 'binancecoin', POL: 'polygon-ecosystem-token' } as Record<string, string>,
} as const

/** How long a fetched price is trusted before it is asked for again. */
export const PRICE_TTL_MS = 5 * 60_000

const CACHE_KEY = 'bioplot:prices'
const MANUAL_KEY = 'bioplot:prices:manual'

export interface Prices {
  /** USD per whole coin, by currency key. */
  usd: Record<string, number>
  at: number
  source: string
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private windows and blocked storage: the price simply is not remembered.
  }
}

/** The last fetched prices, fresh or not; the caller decides whether to refetch. */
export function loadCachedPrices(): Prices | null {
  if (typeof window === 'undefined') return null
  return read<Prices>(CACHE_KEY)
}

/** Reference prices the player typed, for coins with no market. */
export function loadManualPrices(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  return read<Record<string, number>>(MANUAL_KEY) ?? {}
}

export function saveManualPrice(currency: string, usd: number | null): Record<string, number> {
  const key = currencyKey(currency) ?? currency
  const prices = new Map(Object.entries(loadManualPrices()))
  if (usd === null || !Number.isFinite(usd) || usd <= 0) prices.delete(key)
  else prices.set(key, usd)
  const manual = Object.fromEntries(prices)
  write(MANUAL_KEY, manual)
  return manual
}

export function parsePriceResponse(body: unknown, at = Date.now()): Prices | null {
  if (typeof body !== 'object' || body === null) return null
  const entries = new Map(Object.entries(body as Record<string, { usd?: unknown }>))
  const usd = new Map<string, number>()
  for (const [currency, id] of Object.entries(PRICE_SOURCE.ids)) {
    const entry = entries.get(id)
    const value = Number(entry?.usd)
    if (Number.isFinite(value) && value > 0) usd.set(currency, value)
  }
  return usd.size > 0 ? { usd: Object.fromEntries(usd), at, source: PRICE_SOURCE.name } : null
}

/** Fresh prices from the source, or the cache when it is fresh enough, or null. Never throws. */
export async function fetchPrices(signal?: AbortSignal, now = Date.now()): Promise<Prices | null> {
  const cached = loadCachedPrices()
  if (cached && now - cached.at < PRICE_TTL_MS) return cached
  try {
    const ids = Object.values(PRICE_SOURCE.ids).join(',')
    const response = await fetch(`${PRICE_SOURCE.url}?ids=${ids}&vs_currencies=usd`, {
      signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return cached
    const prices = parsePriceResponse(await response.json(), now)
    if (prices) write(CACHE_KEY, prices)
    return prices ?? cached
  } catch {
    return cached
  }
}

/** USD per whole coin for a currency, fetched or manual, or null when neither exists. */
export function priceOf(
  currency: string,
  prices: Prices | null,
  manual: Record<string, number> = {},
): number | null {
  const key = currencyKey(currency)
  if (!key) return null
  return new Map(Object.entries(prices?.usd ?? {})).get(key) ?? new Map(Object.entries(manual)).get(key) ?? null
}

/** A raw amount (the game's integer units) in USD, or null without a price. */
export function usdOf(
  raw: number,
  currency: string,
  prices: Prices | null,
  manual: Record<string, number> = {},
): number | null {
  const price = priceOf(currency, prices, manual)
  if (price === null) return null
  const decimals = tokenFor(currency)?.decimals ?? 9
  return (raw / 10 ** decimals) * price
}

const usdFormat = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})
const usdSmall = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 2,
})

export function formatUsd(value: number): string {
  if (value === 0) return usdFormat.format(0)
  return value < 0.01 ? usdSmall.format(value) : usdFormat.format(value)
}
