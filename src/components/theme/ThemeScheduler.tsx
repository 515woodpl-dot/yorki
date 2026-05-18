'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { getAppThemeForNow, type AppThemeMode } from '@/lib/utils'

export default function ThemeScheduler({ mode }: { mode: AppThemeMode }) {
  const { setTheme } = useTheme()

  useEffect(() => {
    const applyTheme = () => {
      setTheme(mode === 'auto' ? getAppThemeForNow() : mode)
    }

    applyTheme()

    if (mode !== 'auto') return

    const intervalId = window.setInterval(applyTheme, 60_000)
    return () => window.clearInterval(intervalId)
  }, [mode, setTheme])

  return null
}
