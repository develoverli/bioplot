/**
 * How often a player actually comes back to the farm.
 *
 * A plan that assumes you replant the second a crop ripens is only true for someone sitting on
 * the game all day. Everyone else loses the difference silently: their fast crops sit ripe for
 * hours. Making the interval explicit turns that loss into a choice, and usually changes which
 * seed is best — a 14-minute crop is worthless to someone who checks twice a day.
 */
export type Attendance = 'machine' | 'hybrid' | 'away'

export interface AttendanceMode {
  id: Attendance
  label: string
  hint: string
  /** Seconds between visits. Zero means continuously. */
  everySec: number
}

export const ATTENDANCE_MODES: AttendanceMode[] = [
  {
    id: 'machine',
    label: 'Machine',
    hint: 'Replanting the moment anything ripens. The ceiling, not a routine.',
    everySec: 0,
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    hint: 'A look every 4 hours, in step with the reward pools.',
    everySec: 4 * 3600,
  },
  {
    id: 'away',
    label: 'Unattended',
    hint: 'Morning and night. Long crops only, and nothing wasted.',
    everySec: 12 * 3600,
  },
]

export function attendanceSec(mode: Attendance): number {
  return ATTENDANCE_MODES.find((entry) => entry.id === mode)?.everySec ?? 0
}
