---
name: chainers-farm
description: Domain knowledge for Chainers.io farm mechanics — seeds, plots/beds, phytolamps, fertilizers, lands, biopoints and reward pools — plus the on-chain and game-API surfaces available to third-party tools. Use whenever working on bioplot, computing biopoints yields, reasoning about what to plant, or touching data/seeds.json, data/game.json, or the optimizer.
---

# Chainers Farm — mechanics and data model

Everything here comes from the official GitBook (`https://docs.chainers.io/chainers-docs/llms-full.txt`)
and from live probing of `explorer.chainers.io`. Rebuild the datasets with:

```bash
python scripts/extract-docs.py
```

## The loop that matters

Plant a seed in a plot → wait the growth time → harvest N crop items → send crop items to a
Reward Pool → get a share of $BNB / $POL / $CFB proportional to the biopoints you contributed.

**Biopoints are the only scoring currency.** Optimising "what to plant" means maximising
biopoints per plot per unit of time.

## The yield formula

For one harvest of seed `s` at rarity `r` in a plot of rarity `p`:

```
growthTime   = s.variants[r].growthSec × (1 − lamp.growthTimeReduction)
critChance   = plot[p].criticalChance
normalDrop   = plot[p].normalDrop
critDrop     = lamp ? normalDrop × lamp.criticalMultiplier : plot[p].criticalDrop
E[items]     = (1 − critChance) × normalDrop + critChance × critDrop
E[biopoints] = (1 − lamp.rarityUpgradeChance) × bp[r] + lamp.rarityUpgradeChance × bp[r+1]
harvest      = E[items] × E[biopoints] × land.productionMultiplier
```

Rate to compare seeds against each other: `harvest / growthTime` (biopoints per second).

That figure is an **expected value**: criticals and lamp upgrades are dice. The honest spread
is worth reporting alongside it, because a legendary plot swings hard:

```
plain = normalDrop × bp[r] × land            // no crit, no upgrade
lucky = critDrop   × bp[r+1 or r] × land     // every crit, every upgrade
```

A common plot cannot crit at all, so its plain and lucky ends are the same number; a legendary
plot under a rare lamp spans roughly 2× between them.

### Rules the formula encodes

- **Crop rarity = seed rarity.** A plot never changes rarity; only a phytolamp can push a crop
  one tier up, at its `rarityUpgradeChance`.
- **Plot rarity = quantity.** `common 1/1 · uncommon 2/4 · rare 4/8 · epic 8/15 · legendary 16/32`
  (normal drop / critical drop), with critical chances `0% · 0.05% · 1.5% · 4% · 10%`.
- **A lamp REPLACES the plot's critical multiplier** with its own (×2.05 / ×2.15 / ×2.35), and
  also cuts growth time by 3% / 7% / 15%.
- **Lamps do not stack.** One lamp per plant; a second lamp adds nothing. The bonus only counts
  if the plant was *both planted and grown* under the lamp.
- **Golden Acres gives ×2 to total production.** Other lands are ×1.
- **Water seeds need water plots** (Tranquil Waters). `seed.medium` carries this.
- **Legendary fertilizer halves the REMAINING growth time**, so it is worth most on long crops
  and right after planting. It is a one-shot consumable, not a steady-state modifier.

### Seed supply

- **Renewable seeds** (everything except type `Disposable`) come back on harvest — infinite replants.
- **Disposable seeds** are consumed. They are one-shot items in the schedule.
- Legacy ("old") seeds also do not return, cannot be merged, and cannot drop from boosters.

**Owning a seed is a hard requirement, and owning ONE is not owning many.**

Renewable means *comes back on harvest*, not *appears from nowhere*. Two consequences, and the
second is easy to miss:

- Zero of a seed means it cannot be planted at all.
- One seed is infinite in **time** but not in **parallel**. It keeps a single bed busy all day,
  yet it cannot grow in two beds at once. Six beds planted with the same seed need six seeds.

So renewables are budgeted in **seed-seconds**: `count × horizon`, spent at the growth time of
each planting, shared across every bed. One-shot seeds are simply counted. Only two things
loosen this: the "ignore what I own" toggle, and an inventory nobody has imported yet.

**How often the player returns changes the answer.** A plot cannot be replanted while nobody
is there, so between two visits it holds exactly one crop. With a check interval the plan stops
being "fill every minute" and becomes "the best crop that ripens before I come back" — usually
a different seed entirely, because a 14-minute crop is worthless to someone who logs in twice a
day. `checkEverySec` in `optimize()` carries this; zero means continuously.

This is why the optimizer is a *knapsack over time per plot*, not a simple "best rate wins":
a plot has 24h of capacity, renewable seeds are unlimited-count items, disposable seeds are
bounded-count items, and only harvests that **complete** inside the window score.

## Reward pools

- Distribution every **4 hours** → 6 cycles per day. Contributions inside an open window are unlimited.
- Currencies: $BNB, $POL, $CFB. Withdrawal limits: 0.016 BNB, 50 POL.
- 4 account tiers, based on lifetime biopoints contributed.
- **Seeds and plots cannot be contributed** — only harvest items.
- Your payout is your share of the pool, so absolute biopoints matter, not just efficiency.

## Data files

| File | Contents |
| --- | --- |
| `data/seeds.json` | 48 seed families × up to 5 rarities: biopoints, growth seconds, medium, renewable |
| `data/game.json` | Plot / lamp / land / fertilizer tables, reward-pool constants, mechanic notes |
| `data/animals.json` | Animal product biopoints (not scheduled by the v1 optimizer — animals need crafted feed) |

### Docs are the base layer, the game overrides it

`/api/farm/data/vegetables` reports `rewardPoolBaseWeight` per crop, which **is** the biopoint
weight the reward pool uses. When a capture carries it, `src/lib/effective.ts` overlays it (and
any live growth time) onto `data/seeds.json` and the planner runs on the result.

The docs stay as the base because they carry two facts the catalogue never reports: whether a
seed regrows, and whether it needs water. A catalogue row that matches no known family is
reported as unmatched, never guessed into the planner with default flags.

Everything that plans takes the catalogue as an argument — `optimize(inventory, { seeds })`,
`rankVariants(seeds, …)`, `planLamps(garden, horizonSec, seeds)` — so nothing silently reaches
for the docs behind your back.

## Blockchain and API surface

See `references/data-sources.md` for the full probe log. Summary:

- Chainers Chain is a **Polygon Edge sidechain** with its own Blockscout at
  `https://explorer.chainers.io` — **not** on polygonscan.
- Exactly four ERC-721 collections exist: `Chainers` (avatars), `Items` (cosmetics),
  `Farm Lamps`, `Farm Robots` (croppers).
- **Seeds and plots are NOT on-chain.** They live in the game database. Any tool that wants a
  player's real seed/plot inventory has to read it from the game client.
- The game API lives under `https://chainers.io/api/farm/*`, is authenticated with
  `X-Request-Token-ID` / `x-csrf` headers, and is undocumented.

### Security posture for this project (non-negotiable)

- **Never proxy or store a player's session token on a server.** The browser extension reads the
  inventory on the player's own machine and nothing leaves it.
- **Read-only.** The extension never plants, harvests, buys, or sends a transaction. This is an
  analysis tool, not a bot.
- The web app must stay fully usable with manual input, so no player is forced to install anything.

## A seed is locked until the next visit

Seed-seconds assume the player is there to replant the moment a crop ripens: a renewable seed
costs its growth time and is then free for another plot. That is only true in machine mode.

Under an attendance interval everything is planted at the visit and nothing moves until the
next one, so one planting reserves the seed for the **whole interval**, not its growth time.
Charging only the growth time let a single seed fill several plots at once, and the plan then
named seeds the player does not own — the exact failure the ownership rule exists to prevent.

`Option.lockSec` is `max(growthSec, intervalSec)`, and both the availability check and the
spend step use it. `src/lib/optimizer.test.ts` pins it: one seed, six plots, a visit every four
hours means at most six plantings in the day.

## Feed rarity is not negotiable

A recipe's ingredients carry their own rarity in their codes, so epic feed is made from epic
produce and nothing else. Holding an epic pea and a rare corn makes neither the epic recipe nor
the rare one.

Which is why the animal panel lists **every** feed rarity with its full recipe and what is held
of each ingredient, rather than only the one that can be made. The useful answer is not "you
cannot feed this animal" but "one epic corn, or one rare pea, and you can".
