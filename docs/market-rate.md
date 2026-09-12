# Market rate: reading the reward pools off the chain

Bioplot answers "when should I send my harvest to the pool?" from what every block actually
paid, not just the ones you were in. This page explains where that data comes from, how it
is turned into a rate, and what it costs. Everything here was verified against the explorer
on 2026-09-12; `src/lib/chain.ts` carries the constants.

## Why the game API is not enough

`/api/farm/reward-pools/user-blocks-payouts` reports every block **you** contributed to, with
the block's total weight and payout. That already gives the true rate for those blocks. It
says nothing about blocks you skipped, which are exactly the ones you want to know about.

## What is public

Chainers Chain is a Polygon Edge sidechain with a Blockscout explorer at
`https://explorer.chainers.io`. Crops, animal products and the three reward currencies are
all ERC-20 tokens on it, and every pool block has its own **vault**: a fresh address that
lives for one block.

| Moment | What happens on chain |
| --- | --- |
| Block opens | The block's payout lands in the vault: minted from the zero address for CFB and POL, transferred from a treasury for BNB. Four vaults open at once per currency, one per tier, each with a different amount. |
| For four hours | Every contribution arrives as a token transfer into the vault: `2 × Common Strawberry`, `1 × Legendary Egg`. |
| Close + ~90 s | The vault pays the whole amount out, one transfer per contributor, and is left empty. It is never reused. |

The game itself points at the vault: the live block's `explorerBlockURL` is the vault's page.

Currency tokens (all 9 decimals, the same scale the game's `blockPayoutAmount` uses):

| Currency | Token |
| --- | --- |
| CFB | `0xeB811E3ee5e5372CBE93397770a8256E10969024` |
| BNB | `0x61091c8a8127a1EeD0ddACfDdb83Ae62D9f17feB` |
| POL | `0x2d1B7E31CB3631227Ab0DE7a6677e43782957717` (the MATIC token) |

## From vault to rate

For one settled block the app does three things, all with the explorer's public API:

1. **Find the chain block at the moment the pool block opened.**
   `api?module=block&action=getblocknobytime&timestamp=<open>&closest=after`
2. **Find the vault.** List the currency token's transfers in the next couple of hundred chain
   blocks and take the one whose amount equals your tier's payout. Amounts differ per tier,
   so the amount alone picks the vault.
   `api?module=account&action=tokentx&contractaddress=<token>&startblock=<a>&endblock=<b>`
3. **Read the vault.** One call returns everything it ever saw (about 2,900 rows).
   `api?module=account&action=tokentx&address=<vault>&offset=10000`

Then:

```
total weight = Σ (units of crop × weight of that crop)
rate         = payout / total weight          (currency per biopoint)
index        = rate / mean rate of the window (1.00 is average)
```

The weight of a crop is `rewardPoolBaseWeight` from the captured catalogue when you have
synced, and the docs' biopoint table otherwise. A crop token that matches neither is **not
guessed**: the block is listed as incomplete, its total is shown as a floor, and it is left
out of every average.

Blocks close at the same six local hours every day, so the window is summarised per closing
hour. The live block's verdict compares its closing hour with the others and checks whether
the block is already fuller than that hour normally ends.

## Window, cost, refresh

- The app keeps the last **50 settled blocks per currency** for your tier (about eight days).
  Older blocks drop off; averages over months would hide what the pool is doing this week.
- Reading one block is three explorer calls, the last of them around twenty seconds. The
  first fill of 150 blocks runs in the background with a progress bar, three currencies in
  parallel, and every finished block is saved to IndexedDB before the next starts. Closing the
  tab loses at most one block of work.
- Afterwards the app waits for the next close plus a three-minute grace, then reads the three
  new blocks. With the tab closed nothing runs; on the next visit the missing closes are read
  in one catch-up pass, never more than the window.
- Requests go straight from your browser to `explorer.chainers.io`; the explorer sends
  `Access-Control-Allow-Origin: *`. They carry vault addresses and block numbers, nothing about
  you. See [PRIVACY.md](../PRIVACY.md).

## What can break it

- The game changes the block length, the funding pattern, or the token names. The funding
  step then matches nothing and the block is skipped and counted, not invented.
- The explorer is slow or down. Calls retry twice; a block that still fails is skipped and
  picked up on the next pass.
- A tier's payout changes. The live block's payout is re-read from every capture, so the next
  sync looks for the new amount.

## Verifying it yourself

Open any vault on the explorer (the link in the block table). The **Token transfers** tab is
the raw material: crops in, currency out. Sum the crops with the docs' biopoint table and
divide the payout by it. The number in the app is that.
