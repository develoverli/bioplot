/**
 * The single owner of stored captures.
 *
 * Content scripts run once per frame, and the farm lives in an iframe. When each of those
 * frames kept its own list and wrote the whole thing back to chrome.storage.local, the last
 * frame to write erased what the others had found: the farm endpoints would appear and then
 * vanish depending on which frame flushed last.
 *
 * There is exactly one service worker, so making it the only writer removes the race. Content
 * scripts now just forward what they saw and never touch storage.
 */
const STORAGE_KEY = 'captures'
const SEEN_KEY = 'seen'
const RECIPES_KEY = 'recipes'
const RECIPES_ENDPOINT = '/api/main/crafting/offers'
const MAX_CAPTURES = 60
const MAX_SEEN = 200
// chrome.storage.local allows 10 MB; staying under it keeps writes from failing silently
// once the big farm catalogues start landing.
const MAX_TOTAL_BYTES = 6 * 1024 * 1024
const WRITE_DELAY_MS = 500

let captures = null
let seen = null
/** The recipe book: offer code -> trimmed offer, plus the largest page total the game reported. */
let recipes = null
let loading = null
let writeTimer = 0

const emptyRecipes = () => ({ offers: {}, total: 0 })

/** The service worker can be torn down at any time, so state is reloaded on demand. */
async function ensureLoaded() {
  if (captures !== null) return
  if (loading === null) {
    loading = globalThis.chrome.storage.local
      .get({ [STORAGE_KEY]: [], [SEEN_KEY]: {}, [RECIPES_KEY]: emptyRecipes() })
      .then(({ [STORAGE_KEY]: storedCaptures, [SEEN_KEY]: storedSeen, [RECIPES_KEY]: storedRecipes }) => {
        captures = Array.isArray(storedCaptures) ? storedCaptures : []
        seen = new Map(storedSeen && typeof storedSeen === 'object' ? Object.entries(storedSeen) : [])
        recipes =
          storedRecipes && typeof storedRecipes.offers === 'object' && storedRecipes.offers !== null
            ? { offers: storedRecipes.offers, total: Number(storedRecipes.total) || 0 }
            : emptyRecipes()
      })
  }
  await loading
}

/**
 * Keeps every crafting recipe ever seen, not just the last page.
 *
 * The game serves recipes 20 at a time (378 at last count), and the capture store keeps one
 * slot per URL, so pages either overwrote each other or would have crowded the farm itself out
 * of the 60 slots. The book is keyed by offer code instead, which holds whether the game pages
 * by query string or by request body. Only what planning needs is kept: titles and art are
 * dropped, which keeps the whole book well under the storage quota.
 */
const pickItems = (list) =>
  (Array.isArray(list) ? list : []).map((item) => ({
    itemType: item?.itemType,
    itemCode: item?.itemCode,
    count: item?.count,
  }))

const trimOffer = (offer) => ({
  code: offer.code,
  groupCode: offer.groupCode,
  craftingTimeSeconds: offer.craftingTimeSeconds,
  price: offer.price ? { currency: offer.price.currency, amount: offer.price.amount } : null,
  dateTo: typeof offer.dateTo === 'string' ? offer.dateTo : null,
  recipes: (Array.isArray(offer.recipes) ? offer.recipes : []).map((recipe) => ({
    code: recipe?.code,
    isDefault: recipe?.isDefault,
    requiredItems: pickItems(recipe?.requiredItems),
    resultGroups: (Array.isArray(recipe?.resultGroups) ? recipe.resultGroups : []).map((group) => ({
      code: group?.code,
      items: pickItems(group?.items),
    })),
  })),
})

/** An event recipe whose window has closed can no longer be crafted, so it is forgotten. */
const isExpired = (offer, now) => {
  if (typeof offer?.dateTo !== 'string') return false
  const end = Date.parse(offer.dateTo)
  return Number.isFinite(end) && end < now
}

function pruneRecipes(now) {
  for (const [code, offer] of Object.entries(recipes.offers)) {
    if (isExpired(offer, now)) delete recipes.offers[code]
  }
}

function addRecipes(body, now) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return
  }
  const rows = parsed?.data?.items
  if (!Array.isArray(rows)) return

  for (const offer of rows) {
    if (typeof offer?.code !== 'string' || isExpired(offer, now)) continue
    recipes.offers[offer.code] = trimOffer(offer)
  }
  // A filtered view (one group) reports a smaller total than "all", so the largest one seen is
  // the best estimate of how many recipes exist.
  const total = Number(parsed?.data?.total)
  if (Number.isFinite(total) && total > recipes.total) recipes.total = total
  pruneRecipes(now)
}

const recipeBook = () => {
  pruneRecipes(Date.now())
  return { offers: Object.values(recipes.offers), total: recipes.total }
}

/**
 * One slot per endpoint: a later response is simply fresher. Socket frames are already named
 * after their command, so the same rule holds. Only frames that announced no command fall
 * back to keying on the head of the body, so several unnamed shapes survive.
 */
const slotFor = (capture) =>
  capture.url.endsWith('/frame') ? `${capture.url}#${capture.body.slice(0, 80)}` : capture.url

function addCapture(capture) {
  const slot = slotFor(capture)
  const next = [...captures.filter((entry) => slotFor(entry) !== slot), capture]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_CAPTURES)

  // Newest first, so trimming to the byte budget drops the stalest payloads.
  let total = 0
  captures = next.filter((entry) => {
    total += entry.body.length
    return total <= MAX_TOTAL_BYTES
  })
}

function addSeen(item) {
  const key = item.url.split('?')[0]
  if (!key) return

  const previous = seen.get(key)
  if (previous) {
    previous.count += 1
    previous.bytes = item.bytes
    previous.kind = item.kind
    previous.at = item.at
    return
  }
  if (seen.size >= MAX_SEEN) return
  seen.set(key, { bytes: item.bytes, kind: item.kind, count: 1, at: item.at })
}

function scheduleWrite() {
  if (writeTimer !== 0) return
  writeTimer = setTimeout(() => {
    writeTimer = 0
    globalThis.chrome.storage.local.set({
      [STORAGE_KEY]: captures,
      [SEEN_KEY]: Object.fromEntries(seen),
      [RECIPES_KEY]: recipes,
    })
  }, WRITE_DELAY_MS)
}

globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (typeof message !== 'object' || message === null) return undefined

  if (message.type === 'capture' || message.type === 'seen') {
    ensureLoaded().then(() => {
      if (message.type === 'capture') {
        addCapture({ url: message.url, body: message.body, at: message.at })
        if (String(message.url).includes(RECIPES_ENDPOINT)) addRecipes(message.body, Date.now())
      } else {
        addSeen({ url: message.url, bytes: message.bytes, kind: message.kind, at: message.at })
      }
      scheduleWrite()
    })
    return undefined
  }

  if (message.type === 'get') {
    ensureLoaded().then(() =>
      sendResponse({ captures, seen: Object.fromEntries(seen), recipes: recipeBook() }),
    )
    return true
  }

  if (message.type === 'clear') {
    captures = []
    seen = new Map()
    recipes = emptyRecipes()
    globalThis.chrome.storage.local
      .set({ [STORAGE_KEY]: [], [SEEN_KEY]: {}, [RECIPES_KEY]: emptyRecipes() })
      .then(() => sendResponse({ ok: true }))
    return true
  }

  return undefined
})
