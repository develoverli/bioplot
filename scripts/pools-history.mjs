#!/usr/bin/env node
/**
 * Appends the newest settled reward-pool blocks to public/pools-history.json.
 *
 * Every pool block has a throwaway vault on Chainers Chain: funded with the block's payout at
 * open, fed by every contribution as a token transfer for four hours, drained by one payout
 * transfer per contributor after close. All of it is public on the explorer, so this script
 * needs no account, no token and no server: GitHub Actions runs it every hour, commits the
 * file when something new settled, and Pages serves it. The app loads the file first and only
 * asks the chain for what is newer. See docs/market-rate.md.
 *
 * Per block and per currency it records the four tier vaults (told apart by payout amount,
 * because the game does not publish tier names on chain) with the units of every crop token
 * they received. Vaults are found by their payout burst at the close, the one thing on chain
 * that only a vault does. Weights are NOT applied here: the app does that with the player's captured
 * catalogue, which knows event crops the docs do not.
 *
 *   node scripts/pools-history.mjs                 # read whatever settled since the last run
 *   node scripts/pools-history.mjs --backfill 6    # first run: also read the 6 blocks before
 *   node scripts/pools-history.mjs --max 4         # cap the blocks read in one run (default 6)
 *
 * Node 20+, stdlib only.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPLORER = 'https://explorer.chainers.io'
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/pools-history.json')

/** The reward currencies as tokens on Chainers Chain. POL is paid as the MATIC token. */
const CURRENCIES = {
  CFB: '0xeB811E3ee5e5372CBE93397770a8256E10969024',
  BNB: '0x61091c8a8127a1EeD0ddACfDdb83Ae62D9f17feB',
  POL: '0x2d1B7E31CB3631227Ab0DE7a6677e43782957717',
}
const ZERO = '0x0000000000000000000000000000000000000000'
const BLOCK_SECONDS = 14_400
/** A close observed on 2026-09-12; every close is a whole number of blocks from it. */
const ANCHOR_CLOSE = '2026-09-12T08:49:18.000Z'
/** Payouts land within two minutes of the close; wait longer before looking. */
const GRACE_MS = 4 * 60_000
const PAUSE_MS = 250
const PARALLEL = 2

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback
}
const BACKFILL = flag('--backfill', 0)
const MAX_PER_RUN = flag('--max', 6)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJson(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'bioplot-pools-history' } })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} on ${url.slice(EXPLORER.length, EXPLORER.length + 60)}`)
    return await response.json()
  } catch (error) {
    // The explorer answers 502 under load now and then; a short exponential backoff clears it.
    // A 500 on the v1 address query is the endpoint being down, not load: fall through to v2.
    if (attempt >= 4 || (error instanceof Error && error.message.startsWith('500') && url.includes('action=tokentx&address='))) throw error
    await sleep(2000 * 2 ** attempt)
    return getJson(url, attempt + 1)
  }
}

async function blockAt(unixSeconds, closest) {
  const answer = await getJson(
    `${EXPLORER}/api?module=block&action=getblocknobytime&timestamp=${Math.floor(unixSeconds)}&closest=${closest}`,
  )
  const number = Number(answer?.result?.blockNumber)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`no chain block at ${unixSeconds}`)
  return number
}

async function tokenTransfers(token, startBlock, endBlock) {
  const answer = await getJson(
    `${EXPLORER}/api?module=account&action=tokentx&contractaddress=${token}&startblock=${startBlock}&endblock=${endBlock}&sort=asc`,
  )
  return Array.isArray(answer?.result) ? answer.result : []
}

/** Pages small enough that the explorer answers before its gateway gives up on it. */
const PAGE = 2500

async function vaultTransfersV1(vault) {
  const rows = []
  for (let page = 1; page <= 20; page += 1) {
    const answer = await getJson(
      `${EXPLORER}/api?module=account&action=tokentx&address=${vault}&page=${page}&offset=${PAGE}&sort=asc`,
    )
    const result = Array.isArray(answer?.result) ? answer.result : []
    rows.push(...result)
    if (result.length < PAGE) break
    await sleep(PAUSE_MS)
  }
  return rows
}

/**
 * The same list through the v2 API: fifty rows a page, indexed, and still up when the v1
 * address query answers 500. Rows are reshaped to the v1 field names the reader expects.
 */
async function vaultTransfersV2(vault) {
  const rows = []
  let params = ''
  for (let page = 0; page < 400; page += 1) {
    const answer = await getJson(`${EXPLORER}/api/v2/addresses/${vault}/token-transfers${params}`)
    for (const item of answer?.items ?? []) {
      rows.push({
        timeStamp: String(Math.floor(Date.parse(item.timestamp) / 1000)),
        from: item.from?.hash ?? '',
        to: item.to?.hash ?? '',
        value: String(item.total?.value ?? '0'),
        contractAddress: item.token?.address_hash ?? '',
        tokenName: item.token?.name ?? '',
      })
    }
    const next = answer?.next_page_params
    if (!next) break
    params = '?' + new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)])).toString()
  }
  return rows
}

async function vaultTransfers(vault) {
  try {
    return await vaultTransfersV1(vault)
  } catch (error) {
    console.warn(`  ${vault.slice(0, 10)}: v1 failed (${error instanceof Error ? error.message : error}); paging v2`)
    return vaultTransfersV2(vault)
  }
}

/**
 * The vaults of one block, per currency, found by what only a vault does: pay hundreds of
 * players within minutes of the close.
 *
 * Fundings are minted in the seconds around the open, interleaved with the CFB the game mints
 * to players all day, so the open is a poor place to look. The close is unambiguous: each tier
 * vault sends one transfer per contributor in a burst, and no player address does that.
 */
async function findVaults(closeAt) {
  const closeSeconds = Date.parse(closeAt) / 1000
  const start = await blockAt(closeSeconds - 10, 'after')
  await sleep(PAUSE_MS)

  const vaults = {}
  for (const [currency, token] of Object.entries(CURRENCIES)) {
    const rows = await tokenTransfers(token, start, start + PAYOUT_SPAN)
    const sent = new Map()
    for (const row of rows) {
      const from = row.from.toLowerCase()
      if (from === ZERO) continue
      sent.set(from, (sent.get(from) ?? 0) + 1)
    }
    const candidates = [...sent.entries()].filter(([, count]) => count >= MIN_PAYEES).map(([vault]) => vault)
    const kept = []
    for (const vault of candidates) {
      if (await isBusy(vault)) console.warn(`  ${currency}: ${vault} pays like a vault but is a busy address; ignored`)
      else kept.push(vault)
      await sleep(PAUSE_MS)
    }
    vaults[currency] = kept
    await sleep(PAUSE_MS)
  }
  return vaults
}

/** Payout bursts finish within two minutes of the close; five minutes of chain blocks is generous. */
const PAYOUT_SPAN = 150
/** A vault pays every contributor; a player never sends this many currency transfers in five minutes. */
const MIN_PAYEES = 10
/** More token transfers than any vault could gather in four hours: an exchange or the treasury. */
const BUSY_ADDRESS = 20_000

/** Cheap and indexed: a vault holds a few thousand rows, a hot wallet millions the explorer cannot page. */
async function isBusy(address) {
  try {
    const counters = await getJson(`${EXPLORER}/api/v2/addresses/${address}/counters`)
    return Number(counters?.token_transfers_count) > BUSY_ADDRESS
  } catch {
    return true
  }
}

/** Everything a vault's transfer list says about its block, the funding amount included. */
async function readVault(currency, vault) {
  const token = CURRENCIES[currency].toLowerCase()
  const me = vault.toLowerCase()
  const rows = await vaultTransfers(vault)
  const units = {}
  const contributors = new Set()
  let contributions = 0
  let payees = 0
  let paid = 0n
  let payout = 0n
  let fundedAt = null
  for (const row of rows) {
    const isCurrency = row.contractAddress.toLowerCase() === token
    if (row.to.toLowerCase() === me) {
      if (isCurrency) {
        payout += BigInt(row.value)
        fundedAt = fundedAt ?? new Date(Number(row.timeStamp) * 1000).toISOString()
        continue
      }
      contributions += 1
      contributors.add(row.from.toLowerCase())
      units[row.tokenName] = (units[row.tokenName] ?? 0) + Number(row.value)
    } else if (row.from.toLowerCase() === me && isCurrency) {
      payees += 1
      paid += BigInt(row.value)
    }
  }
  return {
    vault,
    payout: payout.toString(),
    paid: paid.toString(),
    fundedAt,
    contributions,
    contributors: contributors.size,
    payees,
    units,
  }
}

async function readBlock(closeAt) {
  const found = await findVaults(closeAt)
  // A block with a currency missing is not worth recording: the app would read it as "no
  // block" for that pool and average around it. Better to retry next run.
  const empty = Object.entries(found).filter(([, vaults]) => vaults.length === 0).map(([c]) => c)
  if (empty.length > 0) {
    console.warn(`  ${closeAt}: no payout burst for ${empty.join(', ')}; not recorded`)
    return null
  }
  const pools = {}
  let openAt = null
  for (const [currency, vaults] of Object.entries(found)) {
    const out = []
    for (let i = 0; i < vaults.length; i += PARALLEL) {
      const slice = vaults.slice(i, i + PARALLEL)
      const results = await Promise.allSettled(slice.map((vault) => readVault(currency, vault)))
      for (const [j, result] of results.entries()) {
        if (result.status === 'fulfilled') out.push(result.value)
        else console.warn(`  ${currency}: ${slice[j]} could not be read (${result.reason?.message ?? result.reason}); skipped`)
      }
      await sleep(PAUSE_MS)
    }
    // A sender with no crops behind it is not a vault, whatever it paid.
    const real = out.filter((entry) => entry.contributions > 0 && entry.payout !== '0')
    if (real.length !== 4) {
      console.warn(`  ${currency}: ${real.length} vault(s) at ${closeAt}, expected 4`)
    }
    for (const entry of real) openAt = openAt ?? entry.fundedAt
    // Largest payout first so tiers read in a stable order; fundedAt stays per vault.
    pools[currency] = real.sort((a, b) => (BigInt(b.payout) > BigInt(a.payout) ? 1 : -1))
  }
  if (Object.values(pools).some((vaults) => vaults.length === 0)) return null
  return { closeAt, openAt: openAt ?? new Date(Date.parse(closeAt) - BLOCK_SECONDS * 1000).toISOString(), pools }
}

async function loadSnapshot() {
  try {
    return JSON.parse(await readFile(OUT, 'utf8'))
  } catch {
    return {
      version: 1,
      updatedAt: null,
      blockTimeSeconds: BLOCK_SECONDS,
      anchorCloseAt: ANCHOR_CLOSE,
      currencies: CURRENCIES,
      blocks: [],
    }
  }
}

/** Every close that has settled by now, newest first, that the snapshot does not have. */
function missingCloses(snapshot, now) {
  const step = BLOCK_SECONDS * 1000
  const have = new Set(snapshot.blocks.map((block) => block.closeAt))
  let latest = Date.parse(snapshot.anchorCloseAt)
  while (latest + step + GRACE_MS <= now) latest += step
  // Newer than the snapshot always; with --backfill, also that many blocks before its oldest.
  const newest = snapshot.blocks[0] ? Date.parse(snapshot.blocks[0].closeAt) : null
  const oldest = snapshot.blocks.length ? Date.parse(snapshot.blocks[snapshot.blocks.length - 1].closeAt) : latest
  const floor = BACKFILL > 0 ? oldest - BACKFILL * step : (newest ?? latest)
  const closes = []
  for (let at = latest; at >= floor; at -= step) {
    const iso = new Date(at).toISOString()
    if (!have.has(iso)) closes.push(iso)
  }
  return closes
}

async function main() {
  const snapshot = await loadSnapshot()
  const now = Date.now()
  const closes = missingCloses(snapshot, now).slice(0, MAX_PER_RUN)
  if (closes.length === 0) {
    console.log('nothing new: newest settled block is already in the snapshot')
    return
  }
  console.log(`reading ${closes.length} block(s): ${closes.join(', ')}`)

  let added = 0
  for (const closeAt of closes) {
    const started = Date.now()
    try {
      const block = await readBlock(closeAt)
      if (!block) {
        console.warn(`  ${closeAt}: no funding found at open; skipped`)
        continue
      }
      snapshot.blocks.push(block)
      added += 1
      const summary = Object.entries(block.pools)
        .map(([currency, vaults]) => `${currency}×${vaults.length}`)
        .join(' ')
      console.log(`  ${closeAt}: ${summary} in ${Math.round((Date.now() - started) / 1000)}s`)
    } catch (error) {
      console.warn(`  ${closeAt}: ${error instanceof Error ? error.message : String(error)}; skipped`)
    }
  }
  if (added === 0) {
    console.log('no block could be read; snapshot unchanged')
    process.exitCode = 0
    return
  }

  snapshot.blocks.sort((a, b) => Date.parse(b.closeAt) - Date.parse(a.closeAt))
  snapshot.updatedAt = new Date().toISOString()
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(snapshot) + '\n')
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${snapshot.blocks.length} blocks, newest ${snapshot.blocks[0].closeAt}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
