'use client'

import { useEffect } from 'react'

/** "224 30% 13%" (the app's CSS variable format) → "#171d2b". */
function hslVarToHex(value: string): string | null {
  const m = value.trim().match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/)
  if (!m) return null
  const h = ((parseFloat(m[1]) % 360) + 360) % 360
  const s = parseFloat(m[2]) / 100
  const l = parseFloat(m[3]) / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return `#${[f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Keeps the browser / phone status-bar colour in step with the app's own theme.
 * The app switches light/dark by time of day (or by an admin setting), which can differ
 * from the phone's setting, so the static `prefers-color-scheme` colours aren't enough.
 * Uses the header colour (--card) so the status bar and the app header look like one piece.
 *
 * Next.js owns the theme-color tags it renders (light + dark, for first paint) — they must not
 * be touched. This adds ONE tag of its own, with no media query, placed before them: browsers
 * use the first theme-color tag that applies, so it wins, and removing it restores the others.
 */
export default function ThemeColorSync() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.setAttribute('data-yorki-theme-color', '')
    document.head.insertBefore(meta, document.head.firstChild)

    const apply = () => {
      const hex = hslVarToHex(getComputedStyle(document.documentElement).getPropertyValue('--card'))
      if (hex) meta.content = hex
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      observer.disconnect()
      meta.remove()
    }
  }, [])

  return null
}
