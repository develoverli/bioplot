import { useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { lands } from '../lib/catalog'
import { RARITIES, type Rarity } from '../lib/types'
import { useStore } from '../store'
import { titleCase } from '../lib/format'
import {
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Modal,
  NumberInput,
  Select,
} from './ui'

const LAMP_OPTIONS = [
  { value: 'none', label: 'No lamp' },
  { value: 'common', label: 'Common lamp (3% faster, +3% rarity)' },
  { value: 'uncommon', label: 'Uncommon lamp (7% faster, +7% rarity)' },
  { value: 'rare', label: 'Rare lamp (15% faster, +15% rarity)' },
] as const

export function PlotsCard() {
  const plots = useStore((state) => state.inventory.plots)
  const addPlotGroup = useStore((state) => state.addPlotGroup)
  const updatePlotGroup = useStore((state) => state.updatePlotGroup)
  const removePlotGroup = useStore((state) => state.removePlotGroup)
  const reset = useStore((state) => state.reset)
  const [confirmReset, setConfirmReset] = useState(false)

  const totalPlots = plots.reduce((sum, group) => sum + group.count, 0)

  return (
    <Card
      title="Your plots"
      description={`${totalPlots} plot${totalPlots === 1 ? '' : 's'} across ${plots.length} group${
        plots.length === 1 ? '' : 's'
      }`}
      actions={
        <>
          <Button variant="ghost" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={15} aria-hidden="true" />
            Reset
          </Button>
          <Button variant="primary" onClick={addPlotGroup}>
            <Plus size={16} aria-hidden="true" />
            Add group
          </Button>
        </>
      }
    >
      {plots.length === 0 ? (
        <EmptyState
          title="No plots yet"
          hint="Add a group for each kind of bed you own: same rarity, same land, same lamp."
        />
      ) : (
        <ul className="@container flex flex-col divide-y divide-[color:var(--border)]">
          {plots.map((group) => (
            <li
              key={group.id}
              className="grid grid-cols-2 items-end gap-3 py-3 first:pt-0 last:pb-0 @2xl:grid-cols-[1fr_1fr_1.4fr_5rem_auto]"
            >
              <Field label="Plot rarity">
                {(id) => (
                  <Select
                    id={id}
                    value={group.rarity}
                    onChange={(event) =>
                      updatePlotGroup(group.id, { rarity: event.target.value as Rarity })
                    }
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
                    value={group.landId}
                    onChange={(event) => updatePlotGroup(group.id, { landId: event.target.value })}
                  >
                    {lands.map((land) => (
                      <option key={land.id} value={land.id}>
                        {land.name}
                        {land.productionMultiplier > 1 ? ' (+100%)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Phytolamp">
                {(id) => (
                  <Select
                    id={id}
                    value={group.lamp ?? 'none'}
                    onChange={(event) =>
                      updatePlotGroup(group.id, {
                        lamp:
                          event.target.value === 'none'
                            ? null
                            : (event.target.value as 'common' | 'uncommon' | 'rare'),
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

              <Field label="How many">
                {(id) => (
                  <NumberInput
                    id={id}
                    min={0}
                    max={999}
                    value={group.count}
                    onChange={(event) =>
                      updatePlotGroup(group.id, {
                        count: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                      })
                    }
                  />
                )}
              </Field>

              <IconButton label="Remove this plot group" onClick={() => removePlotGroup(group.id)}>
                <Trash2 size={17} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset your farm?"
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={() => {
                reset()
                setConfirmReset(false)
              }}
            >
              Reset everything
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          This clears every plot group and seed stack you entered and restores the starter farm.
          Nothing else on your machine is touched, and it cannot be undone.
        </p>
      </Modal>
    </Card>
  )
}
