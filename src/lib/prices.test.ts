import { describe, expect, it } from 'vitest'
import { formatUsd, parsePriceResponse, priceOf, usdOf } from './prices'

describe('parsePriceResponse', () => {
  it('reads the coins it knows and ignores the rest', () => {
    const prices = parsePriceResponse(
      { binancecoin: { usd: 736.73 }, 'polygon-ecosystem-token': { usd: 0.097 }, dogecoin: { usd: 1 } },
      1000,
    )
    expect(prices?.usd).toEqual({ BNB: 736.73, POL: 0.097 })
    expect(prices?.at).toBe(1000)
  })

  it('refuses an answer with nothing usable in it', () => {
    expect(parsePriceResponse({ binancecoin: { usd: 'n/a' } })).toBeNull()
    expect(parsePriceResponse('nope')).toBeNull()
  })
})

describe('priceOf and usdOf', () => {
  const prices = { usd: { BNB: 700, POL: 0.1 }, at: 0, source: 'test' }

  it('maps the game’s spellings and falls back to a manual reference', () => {
    expect(priceOf('IBNB', prices)).toBe(700)
    expect(priceOf('IMATIC', prices)).toBe(0.1)
    expect(priceOf('CFB', prices)).toBeNull()
    expect(priceOf('CFB', prices, { CFB: 0.02 })).toBe(0.02)
  })

  it('converts raw game units through the token decimals', () => {
    // 0.002805 BNB in raw units, at 700 USD.
    expect(usdOf(2_805_000, 'BNB', prices)).toBeCloseTo(1.9635)
    expect(usdOf(850_000_000_000, 'CFB', prices)).toBeNull()
    expect(usdOf(850_000_000_000, 'CFB', prices, { CFB: 0.02 })).toBeCloseTo(17)
  })
})

describe('formatUsd', () => {
  it('keeps two decimals for money and two significant digits for dust', () => {
    expect(formatUsd(1.9635)).toMatch(/1\.96/)
    expect(formatUsd(0.00123)).toMatch(/0\.0012/)
    expect(formatUsd(0)).toMatch(/0\.00/)
  })
})
