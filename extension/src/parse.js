/**
 * Heuristic inventory parser.
 *
 * The game's API is undocumented, so this does not assume a schema. It walks a captured
 * JSON payload looking for arrays of objects that *behave* like inventory rows — something
 * with a rarity, a count, and a name — and classifies each row as a seed or a plot.
 *
 * Whatever it cannot classify is left alone; the raw capture is always kept so a player
 * can export it and the heuristics can be improved from a real sample.
 */
;(() => {
  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']
  const NAME_KEYS = ['name', 'title', 'itemName', 'seedName', 'type', 'kind', 'slug', 'code', 'id']
  const COUNT_KEYS = ['count', 'amount', 'quantity', 'qty', 'total', 'balance', 'stock']
  const RARITY_KEYS = ['rarity', 'rare', 'grade', 'quality', 'tier', 'level']
  const MAX_NODES = 20_000

  const normalise = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '')

  const pick = (row, keys) => {
    const fields = new Map(Object.entries(row))
    for (const key of keys) {
      const value = fields.get(key)
      if (value !== undefined && value !== null) return value
    }
    for (const [key, value] of fields) {
      const lower = key.toLowerCase()
      if (keys.some((candidate) => lower === candidate.toLowerCase())) return value
    }
    return undefined
  }

  /** True when `word` appears in `text` with no a-z letter directly on either side. */
  const containsWord = (text, word) => {
    const isLetter = (char) => char >= 'a' && char <= 'z'
    for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
      if (!isLetter(text.charAt(at - 1)) && !isLetter(text.charAt(at + word.length))) return true
    }
    return false
  }

  const readRarity = (value) => {
    if (typeof value !== 'string') return undefined
    // A numeric rarity could be 0- or 1-based and the game does not say which. Guessing
    // would silently corrupt every plan, so unnamed rarities are refused: the popup then
    // reports "nothing recognised" and the raw capture can be exported to fix the parser.
    const text = value.toLowerCase().trim()

    const exact = RARITIES.find((rarity) => text === rarity)
    if (exact) return exact

    // Then the longest rarity that appears as a WHOLE word. Plain containment matched
    // "common" inside "uncommon", so every uncommon item in the game was recorded one tier
    // too low: wrong feed recipes, wrong plot bonuses, wrong plans.
    return [...RARITIES]
      .sort((a, b) => b.length - a.length)
      .find((rarity) => containsWord(text, rarity))
  }

  const readCount = (value) => {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined
  }

  const seedIdFor = (name) => {
    const table = new Map(Object.entries(globalThis.BIOPLOT_SEED_IDS ?? {}))
    const key = normalise(name)
    return table.get(key) ?? table.get(key.replace(/seeds?$/, ''))
  }

  const looksLikePlot = (text) => /(^|[^a-z])(plot|bed|garden)/i.test(text)

  const MAX_EXPAND_DEPTH = 8

  /**
   * The game double-encodes: a socket frame is {command, value} where `value` is a JSON
   * *string*, not an object. Walking such a payload without expanding it finds nothing, so
   * every JSON-looking string is parsed back into structure before anything else runs.
   */
  function expand(node, level = 0) {
    if (level > MAX_EXPAND_DEPTH) return node

    if (typeof node === 'string') {
      const head = node.trimStart()[0]
      if (head !== '{' && head !== '[') return node
      try {
        return expand(JSON.parse(node), level + 1)
      } catch {
        return node
      }
    }

    if (Array.isArray(node)) return node.map((item) => expand(item, level + 1))

    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [key, expand(value, level + 1)]),
      )
    }

    return node
  }

  /** Classifies a single object. Returns null when it is not an inventory row. */
  function classify(row) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return null

    const rarity = readRarity(pick(row, RARITY_KEYS))
    if (!rarity) return null

    const count = readCount(pick(row, COUNT_KEYS)) ?? 1
    if (count <= 0) return null

    const rawName = pick(row, NAME_KEYS)
    const name = rawName === undefined ? '' : String(rawName)

    const seedId = seedIdFor(name)
    if (seedId) return { kind: 'seed', seedId, name, rarity, count }
    if (looksLikePlot(name) || looksLikePlot(JSON.stringify(row).slice(0, 400))) {
      return { kind: 'plot', rarity, count }
    }
    if (/seed/i.test(name)) return { kind: 'seed', name, rarity, count }
    return null
  }

  const isObject = (value) => value !== null && typeof value === 'object'

  /** Files a classified row into the seed or plot list it belongs to. */
  function fileRow(row, seeds, plots) {
    if (row?.kind === 'seed') {
      seeds.push({ seedId: row.seedId, name: row.name, rarity: row.rarity, count: row.count })
    } else if (row?.kind === 'plot') {
      plots.push({ rarity: row.rarity, count: row.count })
    }
  }

  /** Walks any JSON value and collects everything that classifies. */
  function collect(rawPayload) {
    const payload = expand(rawPayload)
    const seeds = []
    const plots = []
    const queue = [payload]
    let visited = 0

    while (queue.length > 0 && visited < MAX_NODES) {
      const node = queue.shift()
      visited += 1
      if (!isObject(node)) continue

      if (Array.isArray(node)) {
        for (const child of node) queue.push(child)
        continue
      }

      fileRow(classify(node), seeds, plots)

      for (const value of Object.values(node).filter(isObject)) queue.push(value)
    }

    return { seeds, plots }
  }

  /*
   * Schema-aware readers.
   *
   * The heuristics above exist for payloads nobody has seen yet. These two endpoints HAVE
   * been seen, so they are read by their real schema instead of guessed at. Rarity is not a
   * field in this API: it is the prefix of the item code, as in "legendary_vegetable_plot".
   */

  const GARDEN_LANDS = {
    free_garden: 'sunny-field',
    sunny_field: 'sunny-field',
    meadow_grove: 'meadow-grove',
    golden_acres: 'golden-acres',
    tranquil_waters: 'tranquil-waters',
  }

  /** "legendary_vegetable_plot" -> { rarity: "legendary", rest: "vegetable_plot" }. */
  function splitItemCode(code) {
    const parts = String(code ?? '').split('_')
    const head = parts[0]
    if (RARITIES.includes(head)) return { rarity: head, rest: parts.slice(1).join('_') }
    return { rarity: undefined, rest: parts.join('_') }
  }

  const isLampCode = (rest) => /lamp/i.test(rest)
  const isPlotCode = (rest) => /(plot|bed)/i.test(rest)
  /**
   * An animal is a bed too.
   *
   * `/api/farm/control/plant-seed` answers with `farmBedsCode: "common_cattle"` and
   * `groupCode: "animals"`: you plant feed into a cow exactly the way you plant a seed into
   * soil. So anything placed that is not soil and not a lamp is an animal pen, and filtering
   * on "plot" or "bed" in the code silently dropped every animal on the farm.
   */
  const isAnimalCode = (rest) => !isPlotCode(rest) && !isLampCode(rest)

  /**
   * Reads /api/farm/user/inventory.
   *
   * Seeds and spare beds are pulled out because the planner needs them by name. Everything
   * else is kept verbatim under `items`: animals, harvested vegetables, fertilizers and
   * devices all matter for feeding and crafting, and guessing which ones to drop here would
   * mean re-capturing later.
   */
  /** One active, non-empty inventory row with its code split, or null when it is skipped. */
  function inventoryRow(item) {
    if (item?.inventoryType && item.inventoryType !== 'active') return null

    const count = readCount(item?.count) ?? 0
    if (count <= 0) return null

    const itemType = typeof item?.itemType === 'string' ? item.itemType : ''
    const code = typeof item?.itemCode === 'string' ? item.itemCode : ''
    const { rarity, rest } = splitItemCode(code)
    return { itemType, code, rarity, rest, count }
  }

  function readInventory(payload) {
    const seeds = []
    const spareBeds = []
    const items = []

    const rows = payload?.data?.items
    if (!Array.isArray(rows)) return { seeds, spareBeds, items }

    for (const item of rows) {
      const row = inventoryRow(item)
      if (!row) continue
      const { itemType, code, rarity, rest, count } = row

      items.push({ itemType, code, rarity: rarity ?? null, name: rest, count })

      if (!rarity) continue
      if (itemType === 'farmSeeds') {
        seeds.push({ seedId: seedIdFor(rest), name: rest, rarity, count })
      } else if (itemType === 'farmBeds') {
        spareBeds.push({ rarity, count })
      }
    }

    return { seeds, spareBeds, items }
  }

  /**
   * Reads /api/main/crafting/offers: what can be made from what.
   *
   * Each offer is a recipe with the items it consumes and the groups it can produce. Feeding
   * animals runs entirely through here, so the shapes are kept close to the wire rather than
   * flattened: a recipe that can roll several result groups is exactly the interesting case.
   */
  function readCrafting(payload) {
    const rows = payload?.data?.items
    if (!Array.isArray(rows)) return []

    const asItems = (list) =>
      (list ?? [])
        .filter((item) => typeof item?.itemCode === 'string')
        .map((item) => ({
          itemType: String(item.itemType ?? ''),
          code: String(item.itemCode),
          count: readCount(item?.count) ?? 1,
        }))

    return rows
      .filter((offer) => typeof offer?.code === 'string')
      .map((offer) => ({
        code: offer.code,
        groupCode: String(offer?.groupCode ?? ''),
        craftingTimeSeconds: readCount(offer?.craftingTimeSeconds) ?? 0,
        recipes: (offer?.recipes ?? []).map((recipe) => ({
          code: String(recipe?.code ?? ''),
          isDefault: Boolean(recipe?.isDefault),
          requiredItems: asItems(recipe?.requiredItems),
          resultGroups: (recipe?.resultGroups ?? []).map((group) => ({
            code: String(group?.code ?? ''),
            items: asItems(group?.items),
          })),
        })),
      }))
  }

  /**
   * Reads the farm catalogues: /api/farm/data/vegetables and /api/farm/data/seeds.
   *
   * These are the game's own numbers and its own art. `rewardPoolBaseWeight` is the real
   * biopoint weight of a crop, and `farmMedia.previewImageURL` points at the sprite the game
   * itself draws, on the game's CDN. Both beat anything transcribed from the docs.
   *
   * The seed catalogue's exact shape has not been seen yet, so field lookup is tolerant:
   * anything that looks like a growth time is accepted, and missing fields are simply absent.
   */
  const GROWTH_KEYS = [
    'growthTimeSeconds',
    'growthTime',
    'timeToGrowSeconds',
    'growSeconds',
    'growthSeconds',
  ]

  const catalogueRarity = (item, code) =>
    (typeof item?.rarity?.code === 'string' ? readRarity(item.rarity.code) : undefined) ??
    splitItemCode(code).rarity

  /** The first argument that is a string, or null when none is. */
  const firstString = (...values) => values.find((value) => typeof value === 'string') ?? null

  const catalogueImage = (media) => {
    if (typeof media?.previewImageURL === 'string') return media.previewImageURL
    return typeof media?.cardImageURL === 'string' ? media.cardImageURL : null
  }

  /** The first positive growth-time field, rounded, or null when there is none. */
  function catalogueGrowth(item) {
    const fields = new Map(Object.entries(item ?? {}))
    for (const key of GROWTH_KEYS) {
      const value = Number(fields.get(key))
      if (Number.isFinite(value) && value > 0) return Math.round(value)
    }
    return null
  }

  function readCatalogue(payload) {
    const items = payload?.data?.items
    if (!Array.isArray(items)) return []

    const out = []
    for (const item of items) {
      const code = typeof item?.code === 'string' ? item.code : ''
      if (!code) continue

      const rarity = catalogueRarity(item, code)
      if (!rarity) continue

      const media = item?.farmMedia ?? item?.media ?? {}
      const image = catalogueImage(media)

      const growthSec = catalogueGrowth(item)

      const weight = Number(item?.rewardPoolBaseWeight)

      out.push({
        code,
        rarity,
        name: splitItemCode(code).rest,
        biopoints: Number.isFinite(weight) && weight > 0 ? weight : null,
        growthSec,
        image,
      })
    }

    return out
  }

  /**
   * Reads the reward-pool endpoints.
   *
   * `active-blocks-data` is the one that pays: it carries the live block's payout, the total
   * weight everyone has contributed, and YOUR weight in it. Share of the block is
   * userWeight / totalWeight, which is the only number that turns biopoints into currency.
   *
   * `user-level-status` carries the tier and its icon, and `config` carries the pool groups
   * with theirs.
   */
  function readPools(payload) {
    const rows = Array.isArray(payload?.data) ? payload.data : []

    return rows
      .filter((block) => typeof block?.rewardPoolCode === 'string')
      .map((block) => ({
        code: block.rewardPoolCode,
        groupCode: String(block?.rewardPoolsGroupCode ?? ''),
        currency: String(block?.currency ?? ''),
        payout: Number(block?.blockPayoutAmount) || 0,
        totalWeight: Number(block?.totalVegetablesWeight) || 0,
        userWeight: Number(block?.userVegetablesWeight) || 0,
        startDate: String(block?.startDate ?? ''),
        endDate: String(block?.endDate ?? ''),
        explorerURL: String(block?.explorerBlockURL ?? ''),
      }))
  }

  /**
   * Reads /api/farm/reward-pools/user-blocks-payouts: what you were actually paid.
   *
   * Each row is a settled block with the payout, the weight you contributed and the weight
   * everyone contributed. `payoutAmount === blockPayout × userWeight / totalWeight`, which is
   * the same formula the live blocks use — so history and forecast agree by construction.
   */
  function readPayouts(payload) {
    const rows = payload?.data?.items
    if (!Array.isArray(rows)) return []

    return rows
      .filter((row) => typeof row?.rewardPoolCode === 'string')
      .map((row) => ({
        code: row.rewardPoolCode,
        currency: String(row?.currency ?? ''),
        amount: Number(row?.payoutAmount) || 0,
        totalWeight: Number(row?.totalVegetablesWeight) || 0,
        userWeight: Number(row?.userVegetablesWeight) || 0,
        created: String(row?.created ?? ''),
        explorerTxURL: String(row?.explorerTxURL ?? ''),
      }))
  }

  function readPoolConfig(payload) {
    const rows = Array.isArray(payload?.data) ? payload.data : []

    return rows
      .filter((group) => typeof group?.rewardPoolsGroupCode === 'string')
      .map((group) => ({
        groupCode: group.rewardPoolsGroupCode,
        title: String(group?.title ?? group.rewardPoolsGroupCode),
        currency: String(group?.currency ?? ''),
        icon: firstString(group?.media?.tabIconURL, group?.media?.previewIconURL),
        blockTimeSeconds: Number(group?.tiers?.[0]?.blockTimeSeconds) || 0,
      }))
  }

  /**
   * Reads /api/farm/reward-pools/levels-config: the tier ladder.
   *
   * `pointsToClaim` is the lifetime-biopoints threshold for each tier, which is the only way
   * to answer "how far to the next one".
   */
  function readLevels(payload) {
    const rows = Array.isArray(payload?.data) ? payload.data : []

    return rows
      .filter((level) => typeof level?.code === 'string')
      .map((level) => ({
        code: level.code,
        // The ladder carries display names ("Muddy Boots"); keep whichever field has one.
        name: [level?.title, level?.name, level?.levelName].find((v) => typeof v === 'string') ?? null,
        level: Number(level?.level) || 0,
        pointsToClaim: Number(level?.pointsToClaim) || 0,
        icon: firstString(level?.media?.tirIconURL, level?.media?.previewIconURL),
      }))
      .sort((a, b) => a.level - b.level)
  }

  function readLevel(payload) {
    const data = payload?.data
    if (!data || typeof data !== 'object') return null

    return {
      code: String(data?.code ?? ''),
      name: [data?.title, data?.name, data?.levelName].find((v) => typeof v === 'string') ?? null,
      level: Number(data?.level) || 0,
      points: Number(data?.points) || 0,
      visualMaxPoints: Number(data?.visualMaxPoints) || 0,
      icon: firstString(data?.media?.tirIconURL, data?.media?.previewIconURL),
    }
  }

  /**
   * Reads /api/farm/data/beds: what each kind of plot and pen accepts.
   *
   * `type.compatibleFarmVegetablesTypesCodes` is the game's own answer to "what can go in
   * here", which beats guessing from names. For an animal pen it lists the produce types the
   * animal works with, and that is what makes "which feed does this cow take" answerable.
   */
  function readBedTypes(payload) {
    const rows = payload?.data?.items
    if (!Array.isArray(rows)) return []

    return rows
      .filter((bed) => typeof bed?.code === 'string')
      .map((bed) => {
        const media = bed?.farmMedia ?? {}
        return {
          code: bed.code,
          rarity: readRarity(bed?.rarity?.code) ?? splitItemCode(bed.code).rarity ?? null,
          groupCode: String(bed?.type?.groupCode ?? ''),
          typeCode: String(bed?.type?.code ?? ''),
          growthTimeModifier: Number(bed?.growthTimeModifier) || 1,
          compatible: Array.isArray(bed?.type?.compatibleFarmVegetablesTypesCodes)
            ? bed.type.compatibleFarmVegetablesTypesCodes.map(String)
            : [],
          image: typeof media?.previewImageURL === 'string' ? media.previewImageURL : null,
        }
      })
  }

  /**
   * Reads /api/farm/user/gardens as GEOMETRY: every bed and lamp with the tiles it occupies.
   *
   * This is what lets the app draw the farm instead of describing it. Aggregated counts are
   * derived from this by readGardens below, so the two can never disagree.
   */
  /** A placed lamp with its tiles, or null when the device is not a lamp with a rarity. */
  function layoutDevice(device, index, tilesOf) {
    const { rarity, rest } = splitItemCode(device?.itemCode)
    if (!rarity || !isLampCode(rest)) return null
    return {
      id: String(device?.userDevicesID ?? `${index}`),
      code: String(device?.itemCode ?? ''),
      rarity,
      tiles: tilesOf(device?.placementCoordinates),
      covered: tilesOf(device?.coveredCoordinates),
    }
  }

  /** A placed bed or pen with its tiles, or null when it has no rarity or no valid tiles. */
  function layoutBed(bed, index, tilesOf, lampFor) {
    const { rarity, rest } = splitItemCode(bed?.itemCode)
    if (!rarity) return null

    const tiles = tilesOf(bed?.placementCoordinates)
    if (tiles.length === 0) return null

    const planted = bed?.plantedSeed
    return {
      id: String(bed?.userBedsID ?? `${index}`),
      rarity,
      kind: rest,
      isAnimal: isAnimalCode(rest),
      tiles,
      lamp: lampFor(tiles),
      plantedSeedCode: typeof planted?.seedCode === 'string' ? planted.seedCode : null,
    }
  }

  function layoutGarden(garden) {
    const beds = []
    const devices = []
    let maxX = 0
    let maxY = 0

    const tilesOf = (list) =>
      (list ?? [])
        .filter((tile) => Number.isFinite(tile?.x) && Number.isFinite(tile?.y))
        .map((tile) => {
          maxX = Math.max(maxX, tile.x)
          maxY = Math.max(maxY, tile.y)
          return { x: tile.x, y: tile.y }
        })

    for (const device of garden?.placedDevices ?? []) {
      const placed = layoutDevice(device, devices.length, tilesOf)
      if (placed) devices.push(placed)
    }

    const lampFor = (tiles) => {
      const keys = new Set(tiles.map((tile) => `${tile.x},${tile.y}`))
      let best = null
      for (const device of devices) {
        if (!device.covered.some((tile) => keys.has(`${tile.x},${tile.y}`))) continue
        if (best === null || RARITIES.indexOf(device.rarity) > RARITIES.indexOf(best)) {
          best = device.rarity
        }
      }
      return best
    }

    for (const bed of garden?.placedBeds ?? []) {
      const placed = layoutBed(bed, beds.length, tilesOf, lampFor)
      if (placed) beds.push(placed)
    }

    return {
      code: String(garden?.code ?? 'garden'),
      landId: GARDEN_LANDS[garden?.code] ?? 'sunny-field',
      width: Math.max(Number(garden?.size?.width) || 0, maxX + 1),
      height: Math.max(Number(garden?.size?.height) || 0, maxY + 1),
      beds,
      devices,
    }
  }

  function readGardenLayout(payload) {
    const gardens = Array.isArray(payload?.data) ? payload.data : []
    return gardens.map((garden) => layoutGarden(garden))
  }

  /**
   * Reads /api/farm/user/gardens: the farm as it is actually laid out.
   *
   * A bed counts as lit when any tile it occupies falls inside a lamp's covered tiles, which
   * is what the game itself uses to decide the bonus. Where lamps overlap, the strongest wins.
   */
  /** The garden's lamps, each with the set of "x,y" tiles it covers. */
  function gardenLamps(garden) {
    const lamps = []
    for (const device of garden?.placedDevices ?? []) {
      const { rarity, rest } = splitItemCode(device?.itemCode)
      if (!rarity || !isLampCode(rest)) continue
      const tiles = new Set(
        (device?.coveredCoordinates ?? []).map((tile) => `${tile?.x},${tile?.y}`),
      )
      lamps.push({ rarity, tiles })
    }
    return lamps
  }

  /** The strongest lamp covering any of the tiles, or null when none does. */
  function strongestLamp(tiles, lamps) {
    let lamp = null
    for (const candidate of lamps) {
      if (!tiles.some((tile) => candidate.tiles.has(tile))) continue
      if (lamp === null || RARITIES.indexOf(candidate.rarity) > RARITIES.indexOf(lamp)) {
        lamp = candidate.rarity
      }
    }
    return lamp
  }

  /** Counts the garden's soil plots by "rarity|land|lamp". */
  function countPlotGroups(garden, landId, lamps) {
    const groups = new Map()
    for (const bed of garden?.placedBeds ?? []) {
      const { rarity, rest } = splitItemCode(bed?.itemCode)
      // Only soil grows crops; animals are planned separately, from feed.
      if (!rarity || !isPlotCode(rest)) continue

      const tiles = (bed?.placementCoordinates ?? []).map((tile) => `${tile?.x},${tile?.y}`)
      const lamp = strongestLamp(tiles, lamps)

      const key = `${rarity}|${landId}|${lamp ?? 'none'}`
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    return groups
  }

  function readGardens(payload) {
    const plots = []
    const gardens = Array.isArray(payload?.data) ? payload.data : []

    for (const garden of gardens) {
      const landId = GARDEN_LANDS[garden?.code] ?? 'sunny-field'

      const lamps = gardenLamps(garden)
      const groups = countPlotGroups(garden, landId, lamps)

      for (const [key, count] of groups) {
        const [rarity, land, lamp] = key.split('|')
        plots.push({ rarity, landId: land, lamp: lamp === 'none' ? null : lamp, count })
      }
    }

    return plots
  }

  /** Merges the rows found across every capture into one payload for the web app. */
  function toPayload(captures) {
    const seeds = new Map()
    let plots = []
    let gardens = []
    const catalogue = { vegetables: [], seeds: [], beds: [], devices: [] }
    const pools = { blocks: [], groups: [], level: null, levels: [], payouts: [] }
    let spareBeds = []
    let items = []
    let crafting = []
    let sawGardens = false

    const addSeed = (seed) => {
      const key = `${seed.seedId ?? normalise(seed.name)}|${seed.rarity}`
      // A later capture replaces an earlier one: it is the fresher truth.
      seeds.set(key, seed)
    }

    // Checked in order; the first endpoint the capture URL contains reads it.
    const readers = [
      ['/api/farm/user/gardens', (parsed) => {
        plots = readGardens(parsed)
        gardens = readGardenLayout(parsed)
        sawGardens = plots.length > 0
      }],
      ['/api/farm/data/vegetables', (parsed) => {
        catalogue.vegetables = readCatalogue(parsed)
      }],
      ['/api/farm/data/seeds', (parsed) => {
        catalogue.seeds = readCatalogue(parsed)
      }],
      ['/api/farm/data/beds', (parsed) => {
        catalogue.beds = readBedTypes(parsed)
      }],
      // Devices carry the lamp art, which beats any drawing of a lamp.
      ['/api/farm/data/devices', (parsed) => {
        catalogue.devices = readBedTypes(parsed)
      }],
      ['/api/farm/reward-pools/active-blocks-data', (parsed) => {
        pools.blocks = readPools(parsed)
      }],
      ['/api/farm/reward-pools/user-blocks-payouts', (parsed) => {
        pools.payouts = readPayouts(parsed)
      }],
      ['/api/farm/reward-pools/config', (parsed) => {
        pools.groups = readPoolConfig(parsed)
      }],
      ['/api/farm/reward-pools/levels-config', (parsed) => {
        pools.levels = readLevels(parsed)
      }],
      ['/api/farm/reward-pools/user-level-status', (parsed) => {
        pools.level = readLevel(parsed)
      }],
      ['/api/main/crafting/offers', (parsed) => {
        crafting = readCrafting(parsed)
      }],
      ['/api/farm/user/inventory', (parsed) => {
        const read = readInventory(parsed)
        for (const seed of read.seeds) addSeed(seed)
        spareBeds = read.spareBeds
        items = read.items
      }],
    ]

    for (const capture of [...captures].sort((a, b) => a.at - b.at)) {
      let parsed
      try {
        parsed = expand(JSON.parse(capture.body))
      } catch {
        continue
      }

      const reader = readers.find(([endpoint]) => capture.url.includes(endpoint))
      if (reader) {
        reader[1](parsed)
        continue
      }

      // Anything unrecognised still goes through the heuristics.
      const found = collect(parsed)
      for (const seed of found.seeds) addSeed(seed)
      if (!sawGardens && found.plots.length > 0) plots = found.plots
    }

    // Beds sitting in the inventory are only worth planning with when the real layout is
    // unavailable; otherwise they would double-count the ones already placed.
    if (!sawGardens && plots.length === 0) plots = spareBeds

    return {
      version: 1,
      source: 'bioplot-extension',
      capturedAt: new Date().toISOString(),
      seeds: [...seeds.values()],
      plots,
      gardens,
      catalogue,
      items,
      crafting,
      pools,
    }
  }

  /**
   * A compact description of what was captured, small enough to paste into an issue.
   *
   * Reports the SHAPE of each payload — endpoint path, where the arrays of objects live,
   * what keys their rows have — plus one truncated sample row per array. Query strings are
   * dropped and long values are cut, so this stays a schema report rather than a data dump.
   */
  function buildDiagnostics(captures, seen) {
    const MAX_ARRAYS = 8
    const MAX_KEYS = 24
    const MAX_VALUE = 48

    const pathOf = (url) => {
      // Socket captures are already named "ws://host/<command>"; keep that name intact.
      if (url.startsWith('ws://')) return url.replace('ws://', 'socket:')
      try {
        return new URL(url).pathname
      } catch {
        return String(url).split('?')[0]
      }
    }

    const sampleOf = (row) =>
      Object.fromEntries(
        Object.entries(row).slice(0, MAX_KEYS).map(([key, value]) => {
          if (value === null || typeof value !== 'object') {
            return [key, typeof value === 'string' && value.length > MAX_VALUE
              ? `${value.slice(0, MAX_VALUE)}…`
              : value]
          }
          if (Array.isArray(value)) return [key, `[array ${value.length}]`]
          return [key, `{${Object.keys(value).slice(0, 8).join(',')}}`]
        }),
      )

    /** Collects small scalar values so message types and flags are visible in the report. */
    const findScalars = (node, path, out, depth) => {
      if (out.size >= 30 || depth > 3 || node === null || typeof node !== 'object') {
        return
      }
      if (Array.isArray(node)) return

      for (const [key, value] of Object.entries(node)) {
        const at = path ? `${path}.${key}` : key
        if (value === null || typeof value !== 'object') {
          out.set(at, typeof value === 'string' && value.length > MAX_VALUE
            ? `${value.slice(0, MAX_VALUE)}…`
            : value)
        } else {
          findScalars(value, at, out, depth + 1)
        }
      }
    }

    /** Records one array's row keys and a sample row, when it holds any objects. */
    const recordArray = (node, path, found) => {
      const objects = node.filter((item) => item !== null && typeof item === 'object')
      if (objects.length === 0) return
      const keys = new Set()
      for (const item of objects.slice(0, 20)) {
        for (const key of Object.keys(item)) keys.add(key)
      }
      found.push({
        at: path || '(root)',
        length: node.length,
        keys: [...keys].slice(0, MAX_KEYS),
        sample: sampleOf(objects[0]),
      })
    }

    /** Finds every array-of-objects in the payload and records where it lives. */
    const findArrays = (node, path, found, depth) => {
      if (found.length >= MAX_ARRAYS || depth > 12 || node === null || typeof node !== 'object') {
        return
      }

      if (Array.isArray(node)) {
        recordArray(node, path, found)
        for (const item of node.slice(0, 3)) findArrays(item, `${path}[]`, found, depth + 1)
        return
      }

      for (const [key, value] of Object.entries(node)) {
        findArrays(value, path ? `${path}.${key}` : key, found, depth + 1)
      }
    }

    // Every endpoint the observer watched, whether or not its body was kept. This is what
    // separates "never called" from "called but filtered".
    const endpointsSeen = Object.entries(seen ?? {})
      .sort((a, b) => b[1].at - a[1].at)
      .map(([url, info]) => ({
        url: url.startsWith('ws://') ? url.replace('ws://', 'socket:') : pathOf(url),
        kind: info.kind,
        bytes: info.bytes,
        calls: info.count,
      }))

    return {
      tool: 'bioplot',
      note: 'Shape report. Query strings dropped, long values truncated. No headers or cookies are ever captured.',
      seedAliases: Object.keys(globalThis.BIOPLOT_SEED_IDS ?? {}).length,
      endpointsSeen,
      captures: captures.map((capture) => {
        let parsed
        try {
          parsed = JSON.parse(capture.body)
        } catch {
          return { path: pathOf(capture.url), bytes: capture.body.length, error: 'not JSON' }
        }

        parsed = expand(parsed)
        const arrays = []
        findArrays(parsed, '', arrays, 0)
        const found = new Map()
        findScalars(parsed, '', found, 0)
        const scalars = Object.fromEntries(found)
        const rows = collect(parsed)

        return {
          path: pathOf(capture.url),
          bytes: capture.body.length,
          scalars,
          topLevelKeys: Array.isArray(parsed)
            ? '(array)'
            : Object.keys(parsed).slice(0, MAX_KEYS),
          arrays,
          recognised: { seeds: rows.seeds.length, plots: rows.plots.length },
        }
      }),
    }
  }

  globalThis.BioplotParse = {
    classify,
    collect,
    expand,
    readInventory,
    readGardens,
    readGardenLayout,
    readCatalogue,
    readCrafting,
    readBedTypes,
    readPools,
    readPayouts,
    readPoolConfig,
    readLevel,
    readLevels,
    splitItemCode,
    toPayload,
    buildDiagnostics,
  }
})()
