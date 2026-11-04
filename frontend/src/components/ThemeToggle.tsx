import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

const KEY = 'kinnest-theme'

function current(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme
  if (set === 'dark' || set === 'light') return set
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applySavedTheme() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) document.documentElement.dataset.theme = saved
  } catch {
    /* storage blocked: follow the system theme */
  }
}

export default function ThemeToggle() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState(current)
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* ignore */
    }
    setTheme(next)
  }
  return (
    <Button variant="ghost" aria-label={t('theme.toggle')} onClick={toggle} className="min-h-12 w-12 px-0">
      {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
    </Button>
  )
}
