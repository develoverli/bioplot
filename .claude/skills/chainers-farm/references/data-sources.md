# Data sources — probe log (2026-09-02)

## Documentation

| What | URL |
| --- | --- |
| Docs home | https://docs.chainers.io/chainers-docs |
| Machine-readable index | https://docs.chainers.io/chainers-docs/sitemap.md |
| **Whole corpus, one file** | https://docs.chainers.io/chainers-docs/llms-full.txt |
| Any page as markdown | append `.md` to its URL |

`llms-full.txt` is ~247 KB and contains every table verbatim. `scripts/extract-docs.py` parses it.
Note that `https://docs.chainers.io/llms.txt` (without `/chainers-docs`) 307-redirects into the
GitBook app and is useless.

Pages that carry the numbers:

- `chainers/chainers-farm/seeds.md` — the seed × rarity table (biopoints, growth seconds)
- `chainers/chainers-farm/farm-boost-items.md` — plots, phytolamps, fertilizers, lands
- `chainers/chainers-farm/reward-pools.md` — pool cadence, tiers, withdrawal limits
- `chainers/chainers-farm/animals.md` — animal product biopoints
- `chainers/old-junk.md` — patch notes that explain *why* the mechanics are shaped this way
  (bed rarity → yield, lamp rework, the old-vs-new seed split)

## Chain

Chainers Chain — Polygon Edge sidechain, Blockscout explorer at `https://explorer.chainers.io`.
All game assets are ERC-721; all currencies are ERC-20.

```bash
curl -s https://explorer.chainers.io/api/v2/stats
curl -s 'https://explorer.chainers.io/api/v2/tokens?type=ERC-721'
curl -s https://explorer.chainers.io/api/v2/addresses/<WALLET>/nft
```

The complete ERC-721 set (one page, no `next_page_params`):

| Contract | Name | Symbol | What it holds |
| --- | --- | --- | --- |
| `0xA02D08E6f934b7551b54771758Bc6301B04d4592` | Chainers | CHNRS | Player avatars |
| `0x0577B02b7D0E7a1C1A4B5E3452ca43bD13Eaa825` | Items | ITMS | Cosmetics / clothing |
| `0x359aE1F1B562f0e00eC003905bbD4d90eaf6473A` | Farm Lamps | FLA | Phytolamps |
| `0xfd737adf0DbD095EF12705C308d4a89B0Cb592F4` | Farm Robots | RBT | Croppers |

Token metadata carries the useful traits. A phytolamp instance, for example:

```json
{
  "attributes": [{ "trait_type": "Rarity", "value": "Common" }],
  "name": "PHYTOLAMP",
  "description": "Reduction of growth time: 3%\nChance to get higher rarity produce: 3%\nReplacement of plot critical harvest multiplier: х2.05"
}
```

**There is no seeds contract and no plots contract.** That is the single most important finding:
a wallet address alone can tell you a player's lamps and croppers, never their seeds or beds.

### Reward pools are on-chain (confirmed 2026-09-12)

Crops, animal products and the three reward currencies are ERC-20 tokens, and every pool
block has a throwaway **vault** address: funded with the block's payout at open (a mint for
CFB and POL, a treasury transfer for BNB; four vaults per currency, one per tier, distinct
amounts), fed by every contribution as a token transfer for four hours, drained by one payout
transfer per contributor about ninety seconds after close. The live block's
`explorerBlockURL` is that vault. So `payout / Σ(crop units × weight)` is computable for every
block from public data, which is what `src/lib/chain.ts` does; endpoints, costs and limits are
in `docs/market-rate.md`.

Currency tokens (9 decimals): CFB `0xeB811E3ee5e5372CBE93397770a8256E10969024`,
BNB `0x61091c8a8127a1EeD0ddACfDdb83Ae62D9f17feB`, POL as MATIC
`0x2d1B7E31CB3631227Ab0DE7a6677e43782957717`. Blockscout v1 `tokentx` returns a whole vault in
one call with `offset=10000` (~2,900 rows, ~20 s); `getblocknobytime` maps a close time to a
chain block. The explorer sends `Access-Control-Allow-Origin: *`.

ERC-20 references found in the docs: old $CHU on Polygon mainnet
`0x24878dfb65693f975d825e157a0685aec2300ad8`, and `0x571E3DEB36B070083E39432061a7947a39AbdeeF`.

## Game API

`https://chainers.io/api/farm/*` responds `429 Too Many Requests` to anonymous calls (an
unknown route under `/api/` returns `404`, so the `429` confirms the route group exists).
Responses advertise `Access-Control-Allow-Headers: X-Request-Token-ID, x-csrf`, behind Cloudflare.

### What live captures showed (2026-09-03)

Two surfaces, and the farm is not on the REST one.

**REST, `https://chainers.io/api/*`** — envelope is always
`{ "success": true, "data": …, "error": "", "errorCode": "" }`. Observed groups: `/api/main/*`
(user balance, currencies-config, notifications, tutorials, boosters, auth),
`/api/missions/*`, `/api/tournament/*`, `/api/referral/*`, `/api/pe/*`.

`/api/main/general/currencies-config` is worth knowing: it returns each currency with a
`decimal` / `toSmall` factor (CFB is `1000000000`), so raw balances from
`/api/main/user/balance` must be divided by it before display.

**WebSocket, `wss://ws.chainers.io`** — envelope is `{ "command": "<name>", "value": "<JSON
string>" }`. **`value` is double-encoded**: a JSON string, not an object. Anything walking
these payloads has to parse it first (`expand()` in `extension/src/parse.js`).

Commands seen so far, all of them *change notifications* rather than state:

| Command | Payload |
| --- | --- |
| `vegetable` | `{ usersID }` |
| `seed-status-updated` | `{ usersID, itemsIDs }` |
| `rewards-pool-data` | `{ rewardsPoolsBlocksID, … }` |
| `users-missions-tasks-progress-updated` | `{ usersID, parentsID, … }` |
| `pe-xp-updates` | `{ usersID, userXp }` |
| `tournament_points_updates` | `{ usersID, tournament… }` |

The pattern is push-to-invalidate: the socket says *something changed*, and the client then
refetches over REST. So the inventory itself still arrives over HTTP, on a route that only
fires when the relevant screen opens.

### The farm endpoints (confirmed live, 2026-09-03)

The farm runs in an **iframe**, so a content script needs `all_frames: true` to see any of it.
Every response uses the standard envelope; the useful part is always `data`.

| Endpoint | Size | Contents |
| --- | --- | --- |
| `/api/farm/user/gardens` | ~18 KB | The farm as laid out: `placedBeds[]` and `placedDevices[]` |
| `/api/farm/user/inventory` | ~12 KB | `{ inventoryType, itemID, itemType, itemCode, count }` |
| `/api/farm/user/robots` | small | Owned croppers |
| `/api/farm/control/plant-seed` | small | Confirms a planting; reveals `farmBedsCode` and `groupCode` |
| `/api/farm/control/collect-harvest` | small | `harvest[]` plus `additionalRewards[]` — where the returned seed shows up |
| `/api/farm/reward-pools/active-blocks-data` | ~2 KB | Live block: `totalVegetablesWeight`, `userVegetablesWeight`, payout, end date |
| `/api/main/crafting/user-pending-offers` | small | Crafts in flight |
| `/api/farm/data/seeds` | ~600 KB | Seed catalogue |
| `/api/farm/data/vegetables` | ~385 KB | 330 crops, each with **`rewardPoolBaseWeight`** |
| `/api/farm/data/beds` | ~93 KB | 65 beds, each with `growthTimeModifier` |
| `/api/farm/data/devices` | ~10 KB | Phytolamps, with the art the field draws for them |
| `/api/farm/data/devices` | ~27 KB | 13 devices; `common_lamp_device` is `growthTimeModifier: 0.97` |
| `/api/farm/data/fertilizers` | ~10 KB | `growthTimeModifier: 0.5`, `rarityWeightingsModifiers[]` |
| `/api/farm/reward-pools/config` | ~3 KB | Pool groups and tiers, `blockTimeSeconds: 14400` |
| `/api/farm/reward-pools/user-level-status` | small | Current level and lifetime points |
| `/api/main/crafting/offers` | ~33 KB | Merge and feed recipes: `requiredItems[]` and `resultGroups[]` |

A recipe with more than one `resultGroups` entry is a roll, not a guarantee. `src/lib/feed.ts`
reports the worst and best group rather than averaging them, because the odds are not published.

Animal feeding rates are **not** reported anywhere seen so far, so the feed panel stops at
"how much feed you can craft" instead of guessing how long it lasts.

Because the farm is in an iframe, the content script runs in several frames at once. Each
frame sees different traffic, so storage is owned by a single service worker
(`extension/src/background.js`); frames only forward. Letting frames write directly makes farm
captures appear and vanish depending on which frame flushed last.

### An animal is a bed

`/api/farm/control/plant-seed` answers with:

```json
{ "seedCode": "epic_cattle_food", "groupCode": "animals", "farmBedsCode": "common_cattle" }
```

So a pen is a **bed** you plant **feed** into, and feed is a `farmSeeds` item. Animals never
appear as their own inventory type: they sit in `placedBeds` alongside the soil, with codes
like `common_cattle` and `epic_bird`. Filtering `placedBeds` on `/plot|bed/` therefore drops
every animal on the farm — which is exactly what this project did until it was caught.

`isAnimal` in `extension/src/parse.js` is simply "placed, not soil, not a lamp".

Feeding rates are still not reported anywhere, so the app shows what feed can be crafted and
which pens are empty, and stops there.

`/api/farm/data/beds` answers the compatibility question properly:
`type.compatibleFarmVegetablesTypesCodes` lists what a bed accepts, and `type.code` gives the
animal type ("cattle"). Feed is named after the same type: `<rarity>_<type>_food`. So the feed
for a pen is found by type, and the best one is simply the rarest you own.

### Turning biopoints into currency

`/api/farm/reward-pools/active-blocks-data` is the endpoint that makes payouts computable:

| Field | Meaning |
| --- | --- |
| `blockPayoutAmount` | What this block pays in total |
| `totalVegetablesWeight` | Everyone's contributed weight |
| `userVegetablesWeight` | **Yours** |
| `endDate` | When it closes |

Your payout is `userWeight / totalWeight × blockPayoutAmount`, scaled by the currency's
`decimal` from `/api/main/general/currencies-config` (1e9 for CFB). It moves while the block is
open, so it is a reading, not a promise.

Tier and its icon come from `/api/farm/reward-pools/user-level-status` (`media.tirIconURL`),
pool group icons from `/api/farm/reward-pools/config` (`media.tabIconURL`).

**The tier is zero-based.** `level: 0` is the first tier; showing it verbatim reads as "Tier 0"
to a player who is on tier one. `/api/farm/reward-pools/levels-config` carries each rung's
`pointsToClaim`, which is what makes "how far to the next tier" a subtraction instead of a
guess.

### What an animal produces

`/api/farm/data/beds` gives a pen's `type.compatibleFarmVegetablesTypesCodes` (e.g. `["milk"]`)
and `/api/farm/data/vegetables` gives each product's `rewardPoolBaseWeight`. Feeding time comes
from the feed's own `growthTimeSeconds`.

Feed is only worth planning around if it can be made **again**. A recipe consumes produce,
produce grows from a seed, and a renewable seed comes back on harvest — so owning the seed for
every ingredient means the feed never runs out. Seed codes are the produce code plus `_seeds`
(`legendary_strawberry` grows from `legendary_strawberry_seeds`, confirmed by the plant-seed
response), which is what makes this checkable.

Crafting recipes take **ingredients of their own rarity**: an uncommon feed is gated by
uncommon produce. So "a legendary feed exists" and "you can have one today" are different
questions, and only the second is worth planning around. `craftableCount()` answers it from the
harvest actually held.

The one thing the game does not spell out is **which rarity of produce a given feed yields**.
`src/lib/feed.ts` assumes it matches the feed's rarity, which is the pattern the rest of the
farm follows, and the UI labels the figure as an estimate rather than presenting it as fact.

### Settled blocks

`/api/farm/reward-pools/user-blocks-payouts` is the history, one row per settled block:
`payoutAmount`, `currency`, `created`, `totalVegetablesWeight`, `userVegetablesWeight`, and the
explorer transaction.

It confirms the formula exactly. From a real row:

```
850000000000 × 91 / 113878668 = 679231 = payoutAmount   ✓
```

So the rate a biopoint earned in a block is `payoutAmount / userVegetablesWeight`, which equals
`blockPayout / totalVegetablesWeight`. That rate is **not** constant: it rises when few people
contributed. Grouping settled blocks by the local hour they closed is therefore a real answer to
"when is it worth contributing", and `src/lib/pools.ts` does exactly that — refusing to call any
hour "best" below six settled blocks.

**Rarity is not a field.** It is the prefix of the item code: `legendary_vegetable_plot`,
`uncommon_lamp_device`, `common_fertilizer`, `epic_purple_carrot`. `splitItemCode()` in
`extension/src/parse.js` is the single place that knows this.

`itemType` values seen: `farmSeeds`, `farmBeds`, `farmDevices`, `farmFertilizers`,
`farmVegetables`, `farmRobots`.

A garden's `placedDevices[].coveredCoordinates` is how lamp coverage is determined: a bed is
lit when any tile in its `placementCoordinates` falls inside a lamp's covered tiles.

### Live data beats the docs

`/api/farm/data/vegetables` carries `rewardPoolBaseWeight` per crop, and the bed and device
catalogues carry exact `growthTimeModifier` values. These are the numbers the game actually
runs on, where `data/seeds.json` only has what the GitBook published. Wiring the live
catalogue in as an optional override is the highest-value improvement left.

It is undocumented and authenticated. This project therefore:

1. reads the inventory **inside the player's browser**, from the requests the game already makes;
2. never sends a token anywhere;
3. never issues a write.

The response shapes are not published, so `extension/src/parse.js` is written defensively:
it recognises inventory-shaped payloads by their fields rather than by a fixed schema, and it
always keeps the raw capture so a player can export it and the parser can be improved.

## Draw the game's own art, never a substitute

Every catalogue endpoint carries `farmMedia.previewImageURL`, and a pen, a crop or a lamp drawn
from that URL is recognisable at a glance in a way a hand-drawn shape never is. `devices` is the
one that was missed at first, which is why lamps were a yellow disc with a line stuck to it: the
sprite existed all along, it simply was not being captured.

The rule that follows: before drawing a game object, look for its code in the catalogue. Only
fall back to a drawing when the farm was imported before that endpoint was read.

## An unusable feed still gets its picture

A pen whose feed cannot be crafted shows the feed greyed out and struck through, not a bare
cross. The picture answers "what does this animal eat", which stays true whether or not you can
make it; the strike answers "and you cannot make it". A cross on its own destroys the first
answer to give the second.

The recipe panel behind it names the **seed** for each ingredient, not just the produce. Owning
three corn feeds an animal once; owning the corn seed feeds it forever, and only the second ends
the problem.

## A lamp lights a shape, not a rectangle

`coveredCoordinates` is the tile list the game itself lights, and it is not the filled bounding
box of those tiles. Treating the box as the coverage marks the corners as lit, which is how
plots the lamp never reached ended up labelled "Uncommon lamp".

So a lamp being moved carries its offsets, not its width and height, and the anchor it stands on
is carried with them. `planLamps` searches positions with the real shape; `applyLampPlan` draws
back exactly the tiles it assigned. `src/lib/layout.test.ts` pins this with a plus-shaped lamp
whose box corners must stay dark.

## A pen answers to more than one name

Feed is named after the pen's type (`common_cattle` eats `common_cattle_food`), except the name
the feed uses is not always the name the pen's `type.code` uses. The pen also carries a
`groupCode` and the tail of its own item code, so each is tried in turn against the catalogue.

Every candidate comes from the game's own data, so this is a lookup, not a guess: a pen matching
none of them yields no feed at all, and the field draws a dashed slot with a question mark
rather than an empty square.

## `capturedAt` cannot tell you the farm changed

It is stamped when the payload is built, so it moves on every poll whether or not anything
happened. Detecting a real change means hashing what the app plans on — gardens, seeds, plots,
items, live pool blocks — and comparing that (`fingerprint` in `src/lib/bridge.ts`).

The signature of the loaded farm is persisted, so a capture taken while the page was closed is
still recognised as newer. A farm imported before signatures existed has none, and no banner is
shown until the next sync: a missing signature must never be read as "everything changed".

## "uncommon" contains "common"

`readRarity` matched a rarity name anywhere in the label, so `uncommon` returned `common` and
every uncommon item in the game was recorded one tier too low: wrong plot bonuses, wrong feed
recipes, wrong plans, and a feed list that read "Uncommon Cattle Food · Common".

Rarity is now matched exactly first, then as a whole word, longest name first. Any future
substring test over these names has the same trap — `common` sits inside `uncommon` and nowhere
else, which is exactly enough to be missed.

## Ask the pen what it is eating

A pen's own names do not always contain its feed's family: `common_domestic_bird` eats
`epic_bird_food`, and no amount of rearranging "domestic_bird" finds "bird_food". But
`plantedSeedCode` says what the game itself put in the pen, so stripping the rarity and the
`_food` suffix off it yields the family directly. That is an observation, not a guess.
