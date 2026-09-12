import { Monitor, Moon, PlugZap, Sun } from 'lucide-react'
import { useStore, type ThemeChoice } from '../store'
import { Logo } from './Logo'
import { IconButton } from './ui'

const THEME_ORDER: ThemeChoice[] = ['system', 'dark', 'light']

const THEME_META: Record<ThemeChoice, { label: string; Icon: typeof Sun }> = {
  system: { label: 'Theme: follow system', Icon: Monitor },
  dark: { label: 'Theme: dark', Icon: Moon },
  light: { label: 'Theme: light', Icon: Sun },
}


export function Header({ onOpenSetup }: { onOpenSetup: () => void }) {
  const theme = useStore((state) => state.theme)
  const setTheme = useStore((state) => state.setTheme)
  const { label, Icon } = THEME_META[theme]

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg">
      <div className="mx-auto flex max-w-[100rem] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo size={38} className="shrink-0 rounded-[0.55rem]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-ink">Bioplot</p>
            <p className="truncate text-xs text-faint">
              Unofficial biopoint planner for Chainers Farm
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onOpenSetup}
            className="mr-1 inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-sm font-medium text-ink transition-colors duration-150 hover:border-line-strong active:bg-surface-3"
          >
            <PlugZap size={16} aria-hidden="true" />
            Load farm
          </button>
          <IconButton
            label={label}
            onClick={() => {
              const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
              setTheme(next ?? 'system')
            }}
          >
            <Icon size={18} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </header>
  )
}
