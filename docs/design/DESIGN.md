# bioplot — design system

Dark-first, data-dense, one accent. The tool is used at night between reward-pool cycles;
it should read like a well-lit control panel, not a landing page.

## Tokens

Everything is a CSS custom property on `:root`, mirrored into Tailwind v4 via `@theme inline`
(`src/styles/index.css`). Components never hardcode a hex value.

| Token | Dark | Light | Used for |
| --- | --- | --- | --- |
| `--bg` | `oklch(0.16 0.008 155)` | `oklch(0.975 0.006 155)` | Page ground |
| `--surface` | `oklch(0.20 0.010 155)` | `oklch(0.995 0.003 155)` | Cards |
| `--surface-2` | `oklch(0.24 0.012 155)` | `oklch(0.96 0.008 155)` | Inputs, table headers |
| `--surface-3` | `oklch(0.29 0.014 155)` | `oklch(0.93 0.010 155)` | Pressed states, code chips |
| `--border` | `oklch(0.31 0.014 155)` | `oklch(0.90 0.010 155)` | Hairlines |
| `--text` | `oklch(0.95 0.012 155)` | `oklch(0.24 0.020 155)` | Body |
| `--text-muted` | `oklch(0.75 0.018 155)` | `oklch(0.46 0.020 155)` | Secondary |
| `--text-faint` | `oklch(0.62 0.016 155)` | `oklch(0.56 0.018 155)` | Labels, captions |
| `--accent` | `oklch(0.80 0.170 152)` | `oklch(0.55 0.140 152)` | **Biopoints only** |

Colours are OKLCH, never hex, and never pure black or white. Every neutral carries a small
chroma at hue 155 so the greys read as part of the farm rather than as browser default grey.
Chroma drops as lightness approaches either end of the scale.

The accent has exactly one meaning: biopoints, or the primary action that produces them.
It is never decoration.

### The map's own ground

The farm map is the one surface allowed earth tones: `--soil`, `--soil-line` and `--grass`
(hue ~70 and ~140). Everywhere else stays on the green-tinted neutral ramp. A field drawn in
UI greys reads as a spreadsheet, and the whole point of the map is that it reads as a place.

Bed rarity is drawn as the **frame**, not the fill, so the seed sprite inside stays legible on
any rarity. Lamp coverage is a wash on the soil beneath the beds, because that is what it is:
light falling on ground.

### Rarity scale

`common` grey · `uncommon` green · `rare` blue · `epic` purple · `legendary` amber.

Rarity is **always** rendered as a dot *plus the word* (`<RarityBadge>`). Colour alone never
carries meaning — colour-blind players and greyscale printouts read the same information. On
the map, where a frame is the only room available, every bed carries a hover title and an
`aria-label` spelling out its rarity, its lamp and its planting.

## Theming

Three states: `system` (default), `dark`, `light`, cycled from the header.

- `:root` defines the **dark** palette, because that is the product's identity.
- `@media (prefers-color-scheme: light) :root:not([data-theme='dark'])` repaints it light.
- `:root[data-theme='light']` lets the explicit choice win either way.

Light mode is a full repaint with its own contrast-checked values, never an inversion. Both
modes hold ≥4.5:1 for body text and ≥3:1 for secondary text.

## Type

- **Inter Variable** for the interface, **JetBrains Mono Variable** for every number.
- Self-hosted through `@fontsource-variable/*`. No CDN, no external font request.
- Every numeric cell carries `.tabular` (`font-variant-numeric: tabular-nums`) so figures do
  not jitter as the plan recomputes.
- Body 13px / 1.5. Labels 11px uppercase with tracking. The Tailwind scale is redefined one
  step tighter in `@theme` (`xs` 11 · `sm` 13 · `base` 14 · `lg` 16 · `xl` 18 · `2xl` 22), so
  components keep using `text-sm` and the whole page densifies together. No ad-hoc sizes.

## Composition

The results strip is deliberately **not** four equal stat cards. One figure is the answer and
the other three are that same figure cut differently, so they sit at a smaller size beside it,
divided by a hairline. Equal boxes would flatten the hierarchy and produce the dashboard shape
every tool already has.

Cards mark a panel boundary and never nest. Inside a panel, structure comes from hairline
dividers and headings, not from a second border. Rows in the plot editor and blocks in the plan
are separated with `divide-y`, never boxed.

## Layout

- 4/8px spacing rhythm throughout; `rounded-lg` (8px) for controls, `rounded-xl` (12px) for cards,
  `rounded-2xl` (16px) only for the field and the tab panels that replace it.
- One frame, always (`<WorkspaceShell>`): from `xl`, inputs in a 16rem column on the left, the
  field in the middle, a 18rem aside on the right with the farm's summary and the selected
  plot. The same frame renders with or without a farm, so nothing rearranges when data
  arrives. Below `xl` the middle comes first, then the aside, then the inputs.
- A row of tabs sits above the field: Farm, Schedule, Ranking, Animals, Pools. The reference
  tables used to be modals; as tabs they keep the sidebar and the selected plot in place while
  the player looks something up. Tab labels carry counts (hungry pens, live pools) so a closed
  tab is worth opening.
- The inventory editor uses **container queries** (`@container` / `@xl:`) rather than viewport
  breakpoints, so the same card is correct in the narrow sidebar and full width.
- Wide tables scroll inside their own `overflow-x-auto` container. The page body never
  scrolls sideways.

## Interaction

- Minimum 36px control height, 36px icon buttons, 32px for the tab and land buttons that sit
  inside a panel; every icon-only control has `aria-label` and a matching `title`.
- Focus is never removed: a 2px accent ring with 2px offset on `:focus-visible`.
- Transitions are 150ms, colour-only. Nothing animates layout. `prefers-reduced-motion`
  reduces everything to near-zero.
- Sortable table headers expose `aria-sort` and are real buttons, keyboard-operable.
- **No native `alert` / `confirm` / `prompt`.** The single `<Modal>` (a real `<dialog>`, with
  Escape handling and a backdrop) exists for two jobs: loading a farm, and confirming a
  destructive reset where it names exactly what is lost. Reference tables are tabs, never
  modals. Secondary paths use `<Disclosure>` instead, because a modal for an optional flow is
  laziness.
- While the planner recomputes, the totals dim (`.is-stale`) rather than vanish. Numbers never
  disappear and never shift the layout.

## Icons and sprites

Lucide only for interface icons, 15–19px, consistent stroke. No emoji anywhere.

Seed art is different: it comes from the **game's own CDN**, via the `previewImageURL` the
catalogue endpoints report. Nothing is re-hosted and nothing is redrawn, so a sprite always
matches what the player sees in game. Art is optional by construction — when the catalogue has
not been captured, or a URL fails, the bed falls back to its text label.

## Empty and error states

With no farm loaded the middle of the frame is `<EmptyHero>`: what the tool will do once fed,
and both doors to feeding it (the extension, or the manual plot editor inline). Neither door
hides the other. The aside shows the same summary card with zeros rather than disappearing.

Every list has an empty state that says what to do next, not just that something is missing.
Import errors are `role="alert"` and always name a recovery step. The planner surfaces its own
warnings (impossible plots, conservative reconstruction) instead of quietly rounding them away.
