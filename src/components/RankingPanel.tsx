import { useDeferredValue, useMemo, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { lands } from '../lib/catalog'
import { formatBiopoints, formatDuration, formatExact, titleCase } from '../lib/format'
import { RARITIES, type LampRarity, type Rarity, type Seed } from '../lib/types'
import { buildPlotContext, rankVariants, stackKey, type RankedVariant } from '../lib/yield'
import { useStore } from '../store'
import { Card, Field, RarityBadge, Select, TextInput, Toggle } from './ui'

const columnHelper = createColumnHelper<RankedVariant>()

const LAMP_OPTIONS = [
  { value: 'none', label: 'No lamp' },
  { value: 'common', label: 'Common lamp' },
  { value: 'uncommon', label: 'Uncommon lamp' },
  { value: 'rare', label: 'Rare lamp' },
] as const

export function RankingPanel({
  horizonSec,
  catalogue,
  bare = false,
}: {
  horizonSec: number
  /** The numbers to rank on: live where captured, docs otherwise. */
  catalogue: Seed[]
  /** Inside a dialog the card chrome would nest, so it is dropped. */
  bare?: boolean
}) {
  const reference = useStore((state) => state.reference)
  const setReference = useStore((state) => state.setReference)
  const inventorySeeds = useStore((state) => state.inventory.seeds)

  const [ownedOnly, setOwnedOnly] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'horizonBiopoints', desc: true }])

  const owned = useMemo(() => {
    const map = new Map<string, number>()
    for (const stack of inventorySeeds) {
      const key = stackKey(stack.seedId, stack.rarity)
      map.set(key, (map.get(key) ?? 0) + stack.count)
    }
    return map
  }, [inventorySeeds])

  const rows = useMemo(() => {
    const ctx = buildPlotContext({
      plotRarity: reference.plotRarity,
      lamp: reference.lamp,
      landId: reference.landId,
    })
    return rankVariants(catalogue, ctx, { horizonSec, ownedOnly, owned })
  }, [
    catalogue,
    reference.plotRarity,
    reference.lamp,
    reference.landId,
    horizonSec,
    ownedOnly,
    owned,
  ])

  const columns = useMemo(
    () => [
      columnHelper.accessor((row) => row.seed.name, {
        id: 'seed',
        header: 'Seed',
        cell: (info) => (
          <div className="min-w-0">
            <p className="truncate text-ink">{info.getValue()}</p>
            <p className="text-xs text-faint">{info.row.original.seed.type}</p>
          </div>
        ),
      }),
      columnHelper.accessor('rarity', {
        header: 'Rarity',
        cell: (info) => <RarityBadge rarity={info.getValue()} />,
        sortingFn: (a, b) =>
          RARITIES.indexOf(a.original.rarity) - RARITIES.indexOf(b.original.rarity),
      }),
      columnHelper.accessor((row) => row.outcome.growthSec, {
        id: 'growthSec',
        header: 'Grow',
        cell: (info) => <span className="tabular">{formatDuration(info.getValue())}</span>,
        meta: { align: 'right' as const },
      }),
      columnHelper.accessor((row) => row.outcome.biopoints, {
        id: 'perHarvest',
        header: 'Per harvest',
        cell: (info) => (
          <span className="tabular" title={formatExact(info.getValue())}>
            {formatBiopoints(info.getValue())}
          </span>
        ),
        meta: { align: 'right' as const },
      }),
      columnHelper.accessor('cycles', {
        header: 'Harvests',
        cell: (info) => <span className="tabular">{info.getValue()}</span>,
        meta: { align: 'right' as const },
      }),
      columnHelper.accessor((row) => row.outcome.biopointsPerHour, {
        id: 'perHour',
        header: 'Bp / hour',
        cell: (info) => (
          <span className="tabular text-muted" title={formatExact(info.getValue())}>
            {formatBiopoints(info.getValue())}
          </span>
        ),
        meta: { align: 'right' as const },
      }),
      columnHelper.accessor('horizonBiopoints', {
        header: 'Banked',
        cell: (info) => (
          <span className="tabular font-semibold text-accent" title={formatExact(info.getValue())}>
            {formatBiopoints(info.getValue())}
          </span>
        ),
        meta: { align: 'right' as const },
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: deferredQuery },
    onSortingChange: setSorting,
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).toLowerCase()
      if (!needle) return true
      const variant = row.original
      return (
        variant.seed.name.toLowerCase().includes(needle) ||
        variant.seed.type.toLowerCase().includes(needle) ||
        variant.rarity.includes(needle)
      )
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const visible = table.getRowModel().rows
  const hours = horizonSec / 3600

  const description = `Every seed ranked for one plot of the kind you pick below. "Banked" is what actually lands in your inventory within ${hours}h.`

  const body = (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Plot rarity">
          {(id) => (
            <Select
              id={id}
              value={reference.plotRarity}
              onChange={(event) => setReference({ plotRarity: event.target.value as Rarity })}
            >
              {RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {titleCase(rarity)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Land">
          {(id) => (
            <Select
              id={id}
              value={reference.landId}
              onChange={(event) => setReference({ landId: event.target.value })}
            >
              {lands.map((land) => (
                <option key={land.id} value={land.id}>
                  {land.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Phytolamp">
          {(id) => (
            <Select
              id={id}
              value={reference.lamp ?? 'none'}
              onChange={(event) =>
                setReference({
                  lamp: event.target.value === 'none' ? null : (event.target.value as LampRarity),
                })
              }
            >
              {LAMP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Search">
          {(id) => (
            <TextInput
              id={id}
              value={query}
              placeholder="basil, limited, epic…"
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="mt-3">
        <Toggle
          checked={ownedOnly}
          onChange={setOwnedOnly}
          label="Only seeds I can actually plant"
          hint="Renewable seeds always count as available; one-shot seeds are limited to your stock."
        />
      </div>

      <div className="mt-4 max-h-[32rem] overflow-auto scroll-thin border-t border-line">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <caption className="sr-only">
            Seeds ranked by biopoints banked on a {reference.plotRarity} plot
          </caption>
          <thead className="sticky top-0 z-10 bg-surface-2">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="text-xs uppercase tracking-wide text-faint">
                {headerGroup.headers.map((header) => {
                  const align =
                    (header.column.columnDef.meta as { align?: 'right' } | undefined)?.align ===
                    'right'
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                      className={`border-b border-line px-3 py-2 font-medium ${
                        align ? 'text-right' : 'text-left'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={`inline-flex items-center gap-1 py-1 text-inherit hover:text-ink ${
                          align ? 'flex-row-reverse' : ''
                        }`}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' ? (
                          <ArrowUp size={13} aria-hidden="true" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown size={13} aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown size={13} aria-hidden="true" className="opacity-40" />
                        )}
                      </button>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {visible.map((row) => (
              <tr key={row.id} className="transition-colors duration-150 hover:bg-surface-2">
                {row.getVisibleCells().map((cell) => {
                  const align =
                    (cell.column.columnDef.meta as { align?: 'right' } | undefined)?.align ===
                    'right'
                  return (
                    <td key={cell.id} className={`px-3 py-2 ${align ? 'text-right' : 'text-left'}`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">
            No seed matches. Water seeds need water land, and soil seeds need soil land.
          </p>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-faint">
        Showing {visible.length} of {rows.length} plantable variants.
      </p>
    </>
  )

  if (bare) {
    return (
      <div>
        <p className="mb-3 text-sm text-muted">{description}</p>
        {body}
      </div>
    )
  }

  return (
    <Card title="Best seed per plot" description={description}>
      {body}
    </Card>
  )
}
