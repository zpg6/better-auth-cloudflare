import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') {
    root.style.colorScheme = ''
    root.removeAttribute('data-theme')
  } else {
    root.style.colorScheme = theme
    root.dataset.theme = theme
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system'
    setTheme(saved)
  }, [])

  const cycle = () => {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    setTheme(next)
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {}
    apply(next)
  }

  const glyph = theme === 'system' ? '◐' : theme === 'light' ? '☀' : '☾'
  const label = theme === 'system' ? 'auto' : theme

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${label}. Click to change.`}
      title={`Theme: ${label}`}
      className="btn-ghost"
      style={{ height: '32px', padding: '0 10px', fontSize: '12px', gap: '6px' }}
    >
      <span aria-hidden style={{ fontSize: '13px', lineHeight: 1 }}>
        {mounted ? glyph : '◐'}
      </span>
      <span className="label-meta" style={{ color: 'inherit' }}>
        {mounted ? label : 'auto'}
      </span>
    </button>
  )
}
