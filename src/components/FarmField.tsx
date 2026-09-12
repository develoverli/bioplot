import type { KeyboardEvent } from 'react'
import type { IconLookup } from '../lib/artwork'
import { titleCase } from '../lib/format'
import type { PlanEntry, PlotPlan } from '../lib/optimizer'
import type { Garden, GardenBed, GardenDevice, Rarity } from '../lib/types'

const RARITY_VAR = new Map<Rarity, string>([
  ['common', 'var(--rarity-common)'],
  ['uncommon', 'var(--rarity-uncommon)'],
  ['rare', 'var(--rarity-rare)'],
  ['epic', 'var(--rarity-epic)'],
  ['legendary', 'var(--rarity-legendary)'],
])

/** Hides a sprite that fails to load, so a broken one just leaves the label. */
const hideOnError = (image: SVGImageElement | null) => {
  image?.addEventListener('error', () => {
    image.style.display = 'none'
  })
}

/** One tile is this many user units; CSS scales the whole drawing afterwards. */
const CELL = 32
/**
 * Grass border around the tilled ground, in tiles.
 *
 * Enough to read as a field sitting in a landscape, and no more: the drawing is scaled to a
 * fixed height, so every tile of grass is taken directly out of the size of the plots.
 */
const MARGIN = 1.25

/**
 * How much of the viewport the field may take, and the shape it keeps.
 *
 * The field is sized by its own proportions: the column gives the width, the ratio gives the
 * height. The budget caps a tall land so it never pushes the totals off a desktop screen, and
 * the card around the field applies the same budget to its width, so the map is as large as
 * the screen allows with no dead space beside it.
 */
export const FIELD_HEIGHT = '74vh'

export function fieldAspectRatio(garden: Garden): number {
  const width = garden.width + MARGIN * 2
  const height = garden.height + MARGIN * 2
  return height > 0 ? width / height : 1
}

/** The widest the field's card should be, for this land and this budget. */
export function fieldMaxWidth(garden: Garden): string {
  return `calc(${FIELD_HEIGHT} * ${fieldAspectRatio(garden).toFixed(3)})`
}

function boundsOf(bed: GardenBed) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const tile of bed.tiles) {
    minX = Math.min(minX, tile.x)
    minY = Math.min(minY, tile.y)
    maxX = Math.max(maxX, tile.x)
    maxY = Math.max(maxY, tile.y)
  }

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function shortName(name: string): string {
  return name.replace(/seeds?$/i, '').trimEnd()
}

/**
 * Deterministic ground detail, drawn on the tile grid so it stays pixel-aligned.
 *
 * Flat colour reads as a UI panel; tonal blocks read as ground. Seeding from the garden code
 * keeps the field identical between renders, so nothing shimmers as the plan recomputes.
 */
function groundBlocks(seed: string, cols: number, rows: number) {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  const next = () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507)
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
    hash ^= hash >>> 16
    return (hash >>> 0) / 4294967296
  }

  const blocks: { id: number; x: number; y: number; w: number; h: number }[] = []
  for (let i = 0; i < Math.round(cols * rows * 0.04); i++) {
    blocks.push({
      id: i,
      x: Math.floor(next() * cols),
      y: Math.floor(next() * rows),
      w: 1 + Math.floor(next() * 2),
      h: 1 + Math.floor(next() * 2),
    })
  }
  return blocks
}

export interface FarmFieldProps {
  garden: Garden
  planByBed: Map<string, PlotPlan>
  iconFor: IconLookup
  /** Art by raw item code: animals and their feed are not crops. */
  iconByCode: (code: string) => string | null
  /** Pen id -> the feed code it should be given. */
  feedByPen: Map<string, string>
  /** Pens whose feed is not in the inventory: drawn faded. */
  feedNotOwned: Set<string>
  /** Pens with no feed at all, owned or craftable: marked as blocked. */
  feedImpossible: Set<string>
  selected: string | null
  onSelect: (bedId: string | null) => void
  /** Beds whose lamp differs from the live farm, highlighted as "move a lamp here". */
  changedBeds?: Set<string>
}

/** What a bed or a lamp needs from the field to draw itself. */
interface FieldContext {
  originX: number
  originY: number
  planByBed: Map<string, PlotPlan>
  iconFor: IconLookup
  iconByCode: (code: string) => string | null
  feedByPen: Map<string, string>
  feedNotOwned: Set<string>
  feedImpossible: Set<string>
  selected: string | null
  onSelect: (bedId: string | null) => void
  changedBeds: Set<string> | undefined
}

/** A bed's box on the drawing, in user units. */
interface BedRect {
  px: number
  py: number
  pw: number
  ph: number
}

/** Enter and Space activate a bed, the way they would a button. */
function activateOnKey(event: KeyboardEvent<SVGGElement>, activate: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  activate()
}

function bedAriaLabel(bed: GardenBed, headline: PlanEntry | null): string {
  const lamp = bed.lamp ? ` under a ${bed.lamp} lamp` : ''
  const plant = headline ? `, plant ${headline.seedName} ${headline.plantings} times` : ''
  return `${titleCase(bed.rarity)} ${bed.isAnimal ? bed.kind : 'plot'}${lamp}${plant}`
}

function renderBedTitle(bed: GardenBed, headline: PlanEntry | null) {
  return (
    <title>
      {titleCase(bed.rarity)} {bed.isAnimal ? bed.kind.replace(/_/g, ' ') : 'plot'}
      {bed.lamp && !bed.isAnimal ? `, ${bed.lamp} lamp` : ''}
      {headline ? ` — plant ${headline.seedName} ×${headline.plantings}` : ''}
    </title>
  )
}

/** Where a crop's sprite sits, how big it is, and whether its label fits. */
function cropLayout(headline: PlanEntry | null, icon: string | null, { py, pw, ph }: BedRect) {
  const roomy = ph >= 96 && pw >= 96
  const iconSize = Math.min(pw, ph) * (roomy ? 0.46 : 0.6)
  const showText = Boolean(headline) && pw >= 60 && (icon ? roomy : ph >= 36)
  const iconY = icon && roomy ? py + ph * 0.36 : py + ph / 2
  return { iconSize, iconY, showText }
}

function renderBedFrame(
  bed: GardenBed,
  rows: number,
  { px, py, pw, ph }: BedRect,
  isSelected: boolean,
  isChanged: boolean,
) {
  return (
    <>
      {/* Worked earth, raised out of the field. */}
      <rect
        x={px + 5}
        y={py + 5}
        width={Math.max(0, pw - 10)}
        height={Math.max(0, ph - 10)}
        rx={5}
        fill={bed.isAnimal ? 'var(--grass-2)' : 'var(--bed)'}
      />
      {/* A dark liner under the rarity frame keeps it readable against light soil. */}
      <rect
        x={px + 5}
        y={py + 5}
        width={Math.max(0, pw - 10)}
        height={Math.max(0, ph - 10)}
        rx={5}
        fill="none"
        stroke="var(--soil)"
        strokeWidth="7"
      />
      {!bed.isAnimal &&
        Array.from({ length: Math.max(1, rows) }, (_, row) => (
        <line
          key={`row${row}`}
          x1={px + 11}
          y1={py + 5 + (row + 0.5) * ((ph - 10) / rows)}
          x2={px + pw - 11}
          y2={py + 5 + (row + 0.5) * ((ph - 10) / rows)}
          stroke="var(--bed-line)"
          strokeWidth="2"
            opacity="0.55"
          />
        ))}
      <rect
        x={px + 5}
        y={py + 5}
        width={Math.max(0, pw - 10)}
        height={Math.max(0, ph - 10)}
        rx={5}
        fill="none"
        stroke={RARITY_VAR.get(bed.rarity)}
        strokeWidth={isSelected ? 7 : 4}
      />
      {isSelected ? (
        <rect
          x={px + 1}
          y={py + 1}
          width={Math.max(0, pw - 2)}
          height={Math.max(0, ph - 2)}
          rx={8}
          fill="none"
          stroke="var(--text)"
          strokeWidth="2.5"
        />
      ) : null}

      {isChanged ? (
        <rect
          x={px}
          y={py}
          width={pw}
          height={ph}
          rx={7}
          fill="none"
          stroke="var(--text)"
          strokeWidth="2.5"
          strokeDasharray="6 5"
          opacity="0.85"
        />
      ) : null}
    </>
  )
}

/** The colour and words under an animal pen. */
function penLabel(bed: GardenBed, blocked: boolean, animalLabel: string) {
  if (bed.plantedSeedCode) return { fill: 'var(--text-muted)', text: animalLabel }
  if (blocked) return { fill: 'var(--danger)', text: 'no feed' }
  return { fill: 'var(--warning)', text: `feed ${animalLabel}` }
}

/*
  An animal pen shows two sprites: the animal, and under it the feed to give it.
  Two pictures answer "what is this and what does it want" without a word.
*/
function renderPen(bed: GardenBed, { px, py, pw, ph }: BedRect, ctx: FieldContext) {
  const animalLabel = bed.kind.replace(/_/g, ' ')
  const animalIcon = ctx.iconByCode(`${bed.rarity}_${bed.kind}`)
  const feedCode = ctx.feedByPen.get(bed.id)
  const feedIcon = feedCode ? ctx.iconByCode(feedCode) : null
  const animalSize = Math.min(pw, ph) * 0.42
  const blocked = ctx.feedImpossible.has(bed.id)
  const faded = blocked || ctx.feedNotOwned.has(bed.id)
  const feedFilter = faded ? 'url(#faded)' : undefined
  const feedOpacity = blocked ? 0.55 : 1
  const label = penLabel(bed, blocked, animalLabel)

  return (
    <g shapeRendering="auto">
      {animalIcon ? (
        <image
          href={animalIcon}
          x={px + pw / 2 - animalSize / 2}
          y={py + ph * 0.3 - animalSize / 2}
          width={animalSize}
          height={animalSize}
          preserveAspectRatio="xMidYMid meet"
          ref={hideOnError}
        />
      ) : null}

      {feedIcon ? (
        <image
          href={feedIcon}
          x={px + pw / 2 - animalSize * 0.32}
          y={py + ph * 0.63 - animalSize * 0.32}
          width={animalSize * 0.64}
          height={animalSize * 0.64}
          preserveAspectRatio="xMidYMid meet"
          filter={feedFilter}
          opacity={feedOpacity}
          ref={hideOnError}
        />
      ) : null}

      {/*
        A pen with no feed at all in the capture still shows a slot, so the square
        reads as "nothing known yet" rather than as a drawing that failed.
      */}
      {!feedIcon ? (
        <g opacity="0.65">
          <rect
            x={px + pw / 2 - animalSize * 0.32}
            y={py + ph * 0.63 - animalSize * 0.32}
            width={animalSize * 0.64}
            height={animalSize * 0.64}
            rx={animalSize * 0.14}
            fill="none"
            stroke="var(--text-faint)"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
          <text
            x={px + pw / 2}
            y={py + ph * 0.63 + animalSize * 0.14}
            textAnchor="middle"
            fontSize={animalSize * 0.42}
            fontWeight="600"
            fill="var(--text-faint)"
          >
            ?
          </text>
        </g>
      ) : null}

      {/*
        Blocked feed is struck through, not replaced by a bare cross: the greyed
        picture still says which food this animal wants, and the line says you
        cannot make it. Clicking the pen lists the seeds that are missing.
      */}
      {blocked && feedIcon ? (
        <line
          x1={px + pw / 2 - animalSize * 0.34}
          y1={py + ph * 0.63 + animalSize * 0.3}
          x2={px + pw / 2 + animalSize * 0.34}
          y2={py + ph * 0.63 - animalSize * 0.3}
          stroke="var(--danger)"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.9"
        />
      ) : null}

      {pw >= 48 ? (
        <>
          <rect
            x={px + 6}
            y={py + ph - 22}
            width={Math.max(0, pw - 12)}
            height={17}
            rx={4}
            fill="var(--surface)"
            fillOpacity="0.9"
          />
          <text
            x={px + pw / 2}
            y={py + ph - 13}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={Math.min(13, Math.max(10, pw / 9))}
            fill={label.fill}
            fontWeight="600"
          >
            {label.text}
          </text>
        </>
      ) : null}
    </g>
  )
}

function renderCropLabel(headline: PlanEntry, icon: string | null, { px, py, pw, ph }: BedRect) {
  return (
    <g shapeRendering="auto">
      <rect
        x={px + 6}
        y={py + ph - (icon ? 40 : 26)}
        width={Math.max(0, pw - 12)}
        height={icon ? 34 : 20}
        rx={4}
        fill="var(--surface)"
        fillOpacity="0.9"
      />
      <text
        x={px + pw / 2}
        y={icon ? py + ph - 26 : py + ph - 16}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={Math.min(17, Math.max(11, pw / 7.5))}
        fill="var(--text)"
        fontWeight="600"
      >
        {shortName(headline.seedName)}
      </text>
      {icon ? (
        <text
          x={px + pw / 2}
          y={py + ph - 12}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="12"
          fill="var(--text-muted)"
        >
          ×{headline.plantings}
        </text>
      ) : null}
    </g>
  )
}

function renderBed(bed: GardenBed, ctx: FieldContext) {
  const box = boundsOf(bed)
  const plotPlan = ctx.planByBed.get(bed.id)
  const headline = plotPlan?.entries[0] ?? null
  const isSelected = bed.id === ctx.selected
  const isChanged = ctx.changedBeds?.has(bed.id) ?? false
  const rect: BedRect = {
    px: ctx.originX + box.x * CELL,
    py: ctx.originY + box.y * CELL,
    pw: box.w * CELL,
    ph: box.h * CELL,
  }
  const { px, py, pw, ph } = rect

  const icon = headline ? ctx.iconFor(headline.seedId, headline.rarity) : null
  const { iconSize, iconY, showText } = cropLayout(headline, icon, rect)
  const toggle = () => ctx.onSelect(isSelected ? null : bed.id)

  return (
    <g
      key={bed.id}
      role="button"
      tabIndex={0}
      aria-label={bedAriaLabel(bed, headline)}
      className="cursor-pointer outline-none"
      onClick={toggle}
      onKeyDown={(event) => activateOnKey(event, toggle)}
    >
      {renderBedTitle(bed, headline)}

      {renderBedFrame(bed, box.h, rect, isSelected, isChanged)}

      {icon ? (
        <image
          href={icon}
          x={px + pw / 2 - iconSize / 2}
          y={iconY - iconSize / 2}
          width={iconSize}
          height={iconSize}
          preserveAspectRatio="xMidYMid meet"
          // Sprites live on the game's CDN; a broken one just leaves the label.
          ref={hideOnError}
        />
      ) : null}

      {bed.isAnimal ? renderPen(bed, rect, ctx) : null}

      {!bed.isAnimal && !headline && pw >= 60 ? (
        <text
          x={px + pw / 2}
          y={py + ph / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="13"
          fill="var(--soil-line)"
          fontWeight="600"
          shapeRendering="auto"
        >
          empty
        </text>
      ) : null}

      {showText && headline ? renderCropLabel(headline, icon, rect) : null}
    </g>
  )
}

function renderDevice(device: GardenDevice, ctx: FieldContext) {
  const tile = device.tiles[0]
  if (!tile) return null

  /*
    A lamp hangs ABOVE what it lights, centred across it.
    Centred on the coverage horizontally, it reads as belonging to all the lit plots
    rather than to whichever one it touches. Lifted clear of the top of them, it stops
    covering the very crops it is there to explain.
  */
  let sx = 0
  let top = Infinity
  for (const covered of device.covered) {
    sx += covered.x
    top = Math.min(top, covered.y)
  }
  const lit = device.covered.length
  const cx = ctx.originX + (lit > 0 ? sx / lit : tile.x) * CELL + CELL / 2
  const above = lit > 0 ? top : tile.y
  const cy = ctx.originY + above * CELL - CELL * 0.12
  const r = CELL * 0.52

  // The game ships art for every device. Its own lamp beats anything drawn here, so the
  // drawn bulb below is only the fallback for a farm imported before devices were captured.
  const sprite = device.code ? ctx.iconByCode(device.code) : null
  const size = CELL * 1.5

  return (
    <g key={device.id} shapeRendering="auto">
      <title>
        {titleCase(device.rarity)} phytolamp, lighting {device.covered.length} tile
        {device.covered.length === 1 ? '' : 's'}
      </title>

      {/* The glow falls downward, onto the plots, the way light from a lamp does. */}
      <ellipse cx={cx} cy={cy + CELL * 0.5} rx={CELL * 1.5} ry={CELL * 1.1} fill="url(#lamp-glow)" />

      {sprite ? (
        <image
          href={sprite}
          x={cx - size / 2}
          y={cy - size / 2}
          width={size}
          height={size}
          preserveAspectRatio="xMidYMid meet"
          ref={hideOnError}
        />
      ) : (
        <g>
          {/* Bulb: a glass dome on a stem, not a plain disc. */}
          <path
            d={`M ${cx - r} ${cy + r * 0.15}
                A ${r} ${r} 0 1 1 ${cx + r} ${cy + r * 0.15}
                L ${cx + r * 0.5} ${cy + r * 0.95}
                L ${cx - r * 0.5} ${cy + r * 0.95} Z`}
            fill="var(--warning)"
            stroke="var(--soil)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <rect
            x={cx - r * 0.42}
            y={cy + r * 0.95}
            width={r * 0.84}
            height={r * 0.42}
            rx={r * 0.14}
            fill="var(--soil)"
          />
          <circle
            cx={cx - r * 0.32}
            cy={cy - r * 0.3}
            r={r * 0.22}
            fill="var(--bed)"
            opacity="0.7"
          />
        </g>
      )}
    </g>
  )
}

export function FarmField({
  garden,
  planByBed,
  iconFor,
  iconByCode,
  feedByPen,
  feedNotOwned,
  feedImpossible,
  selected,
  onSelect,
  changedBeds,
}: FarmFieldProps) {
  const soilW = garden.width * CELL
  const soilH = garden.height * CELL
  const width = soilW + MARGIN * 2 * CELL
  const height = soilH + MARGIN * 2 * CELL
  const originX = MARGIN * CELL
  const originY = MARGIN * CELL

  const litTiles = new Map<string, Rarity>()
  for (const device of garden.devices) {
    for (const tile of device.covered) litTiles.set(`${tile.x},${tile.y}`, device.rarity)
  }

  const grassBlocks = groundBlocks(garden.code, width / CELL, height / CELL)
  const soilBlocks = groundBlocks(`${garden.code}-soil`, garden.width, garden.height)

  const ctx: FieldContext = {
    originX,
    originY,
    planByBed,
    iconFor,
    iconByCode,
    feedByPen,
    feedNotOwned,
    feedImpossible,
    selected,
    onSelect,
    changedBeds,
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label={`Farm field: ${garden.beds.length} plots`}
      shapeRendering="crispEdges"
      /*
        The box is the land's own shape: width from the column, height from the aspect ratio.
        A fixed height letterboxed the map on a phone, where the width runs out long before the
        height does. The vh cap keeps a tall land from pushing the totals off a desktop screen,
        and the matching max width keeps the box on the ratio when that cap is what binds.
      */
      className="mx-auto block h-auto w-full"
      style={{ aspectRatio: `${width} / ${height}`, maxHeight: FIELD_HEIGHT }}
    >
      <defs>
        {/* Feed you do not have is shown, but drained of colour: present, not available. */}
        <filter id="faded">
          <feColorMatrix
            type="matrix"
            values="0.33 0.33 0.33 0 0
                    0.33 0.33 0.33 0 0
                    0.33 0.33 0.33 0 0
                    0    0    0  0.75 0"
          />
        </filter>
        {/* A lamp reads as a lamp when it glows. A flat disc just reads as a dot. */}
        <radialGradient id="lamp-glow">
          <stop offset="0%" stopColor="var(--warning)" stopOpacity="0.55" />
          <stop offset="55%" stopColor="var(--warning)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--warning)" stopOpacity="0" />
        </radialGradient>
        <clipPath id="field-clip">
          <rect width={width} height={height} rx={16} />
        </clipPath>
        <clipPath id="soil-clip">
          <rect x={originX} y={originY} width={soilW} height={soilH} rx={6} />
        </clipPath>
      </defs>

      <g clipPath="url(#field-clip)">
        <rect width={width} height={height} fill="var(--grass)" />
        {grassBlocks.map((block) => (
          <rect
            key={`g${block.id}`}
            x={block.x * CELL}
            y={block.y * CELL}
            width={block.w * CELL}
            height={block.h * CELL}
            fill="var(--grass-2)"
            opacity="0.55"
          />
        ))}
      </g>

      <g clipPath="url(#soil-clip)">
        <rect x={originX} y={originY} width={soilW} height={soilH} fill="var(--soil)" />
        {soilBlocks.map((block) => (
          <rect
            key={`s${block.id}`}
            x={originX + block.x * CELL}
            y={originY + block.y * CELL}
            width={block.w * CELL}
            height={block.h * CELL}
            fill="var(--soil-line)"
            opacity="0.45"
          />
        ))}

        {/* Tile grid, so a player can count squares the way they do in game. */}
        {Array.from({ length: garden.width + 1 }, (_, i) => (
          <line
            key={`vx${i}`}
            x1={originX + i * CELL}
            y1={originY}
            x2={originX + i * CELL}
            y2={originY + soilH}
            stroke="var(--soil-line)"
            strokeWidth="1"
            opacity="0.7"
          />
        ))}
        {Array.from({ length: garden.height + 1 }, (_, i) => (
          <line
            key={`hz${i}`}
            x1={originX}
            y1={originY + i * CELL}
            x2={originX + soilW}
            y2={originY + i * CELL}
            stroke="var(--soil-line)"
            strokeWidth="1"
            opacity="0.7"
          />
        ))}

        {/* Lamp light falls on the ground, so it sits under the beds. */}
        {[...litTiles.entries()].map(([tileKey, rarity]) => {
          const [x, y] = tileKey.split(',').map(Number)
          return (
            <rect
              key={`lit-${tileKey}`}
              x={originX + (x ?? 0) * CELL}
              y={originY + (y ?? 0) * CELL}
              width={CELL}
              height={CELL}
              fill={RARITY_VAR.get(rarity)}
              opacity="0.18"
            />
          )
        })}
      </g>

      <rect
        x={originX}
        y={originY}
        width={soilW}
        height={soilH}
        rx={6}
        fill="none"
        stroke="var(--bed-line)"
        strokeWidth="3"
      />

      {garden.beds.map((bed) => renderBed(bed, ctx))}

      {garden.devices.map((device) => renderDevice(device, ctx))}

    </svg>
  )
}
