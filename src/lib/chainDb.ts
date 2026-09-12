import type { MarketBlock } from './chain'

/**
 * Settled blocks, kept in the browser between visits.
 *
 * Reading a block costs a twenty-second call to the explorer, so a block is read once and
 * kept. IndexedDB rather than localStorage because fifty blocks a currency is more than a
 * string wants to be, and because a write here must never block the planner.
 */
const DB_NAME = 'bioplot-chain'
const DB_VERSION = 1
const STORE = 'blocks'

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('currency', 'currency', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    // A blocked or failing database is not worth an error: the page works without a cache.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return opening
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/** In-memory stand-in for environments without IndexedDB (tests, private windows). */
const memory = new Map<string, MarketBlock>()

export async function loadBlocks(currency: string): Promise<MarketBlock[]> {
  const db = await open()
  if (!db) return [...memory.values()].filter((block) => block.currency === currency)
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    return await settle(store.index('currency').getAll(currency))
  } catch {
    return []
  }
}

export async function saveBlock(block: MarketBlock): Promise<void> {
  const db = await open()
  if (!db) {
    memory.set(block.key, block)
    return
  }
  try {
    await settle(db.transaction(STORE, 'readwrite').objectStore(STORE).put(block))
  } catch {
    // Quota or a closed database: the block is still in memory for this session.
    memory.set(block.key, block)
  }
}

export async function deleteBlocks(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const db = await open()
  if (!db) {
    for (const key of keys) memory.delete(key)
    return
  }
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    await Promise.all(keys.map((key) => settle(store.delete(key))))
  } catch {
    // Stale rows only cost space; the window filter hides them either way.
  }
}

export async function clearBlocks(): Promise<void> {
  memory.clear()
  const db = await open()
  if (!db) return
  try {
    await settle(db.transaction(STORE, 'readwrite').objectStore(STORE).clear())
  } catch {
    // Nothing to do: a cache that cannot be cleared is rebuilt on the next sync.
  }
}
