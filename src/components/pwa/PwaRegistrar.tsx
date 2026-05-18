'use client'

import { useEffect } from 'react'

export function PwaRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    const basePath = process.env.NODE_ENV === 'production' ? '/task' : ''
    const register = navigator.serviceWorker?.register?.bind(navigator.serviceWorker)
    if (!register) return

    register(`${basePath}/sw.js`, { scope: `${basePath}/` }).catch(() => {
      // Keep registration failure from affecting app boot.
    })
  }, [])

  return null
}
