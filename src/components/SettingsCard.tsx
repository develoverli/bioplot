import { Clock4, Moon, Zap } from 'lucide-react'
import { ATTENDANCE_MODES, type Attendance } from '../lib/attendance'
import { useStore } from '../store'
import { Card, CheckSwitch, Field, Select } from './ui'

const HORIZON_OPTIONS = [4, 8, 12, 24, 48]

const ATTENDANCE_ICON: Record<Attendance, typeof Zap> = {
  machine: Zap,
  hybrid: Clock4,
  away: Moon,
}

/** Everything that changes the answer, in the order a player asks it: how long, how often, what with. */
export function SettingsCard() {
  const horizonHours = useStore((state) => state.horizonHours)
  const setHorizonHours = useStore((state) => state.setHorizonHours)
  const ignoreStock = useStore((state) => state.ignoreStock)
  const setIgnoreStock = useStore((state) => state.setIgnoreStock)
  const plantingMode = useStore((state) => state.plantingMode)
  const setPlantingMode = useStore((state) => state.setPlantingMode)
  const attendance = useStore((state) => state.attendance)
  const setAttendance = useStore((state) => state.setAttendance)

  return (
    <Card title="Planning window">
      <Field label="Horizon" hint="Pools pay every 4 hours; a day is 6 cycles.">
        {(id) => (
          <Select
            id={id}
            value={horizonHours}
            onChange={(event) => setHorizonHours(Number(event.target.value))}
          >
            {HORIZON_OPTIONS.map((hours) => (
              <option key={hours} value={hours}>
                {hours} hours
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="mt-3">
        <p className="text-xs font-medium tracking-wide text-faint uppercase">How often you play</p>
        <div className="mt-1 flex flex-col gap-0.5">
          {ATTENDANCE_MODES.map((entry) => {
            const Icon = ATTENDANCE_ICON[entry.id]
            return (
              <CheckSwitch
                key={entry.id}
                checked={attendance === entry.id}
                onChange={() => setAttendance(entry.id)}
                icon={<Icon size={15} aria-hidden="true" />}
                label={entry.label}
                hint={entry.hint}
              />
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-0.5 border-t border-line pt-3">
        <CheckSwitch
          checked={plantingMode === 'single'}
          onChange={(value) => setPlantingMode(value ? 'single' : 'mix')}
          label="One seed per plot"
          hint="Plant it and forget it, instead of a mix."
        />
        <CheckSwitch
          checked={ignoreStock}
          onChange={setIgnoreStock}
          label="Ignore what I own"
          hint="Plan as if every seed were available."
        />
      </div>
    </Card>
  )
}
