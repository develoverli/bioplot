import { Monitor, Moon, Sun } from 'lucide-react'
import { useStore, type ThemeChoice } from '../store'
import { Logo } from './Logo'
import { IconButton } from './ui'

const THEME_ORDER: ThemeChoice[] = ['system', 'dark', 'light']

const THEME_META: Record<ThemeChoice, { label: string; Icon: typeof Sun }> = {
  system: { label: 'Theme: follow system', Icon: Monitor },
  dark: { label: 'Theme: dark', Icon: Moon },
  light: { label: 'Theme: light', Icon: Sun },
}

export function Header() {
  const theme = useStore((state) => state.theme)
  const setTheme = useStore((state) => state.setTheme)
  const { label, Icon } = THEME_META[theme]

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[100rem] items-center justify-between gap-4 px-4 py-2 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo size={30} className="shrink-0 rounded-[0.45rem]" />
          <div className="flex min-w-0 items-baseline gap-2.5">
            <p className="truncate text-sm font-semibold tracking-tight text-ink">Bioplot</p>
            <p className="hidden truncate text-xs text-faint sm:block">
              Unofficial biopoint planner for Chainers Farm
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <IconButton
            label={label}
            onClick={() => {
              const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
              setTheme(next ?? 'system')
            }}
          >
            <Icon size={17} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </header>
  )
}
