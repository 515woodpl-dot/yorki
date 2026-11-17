'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/** Tells people when the connection is gone, so a failed save isn't a mystery. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  if (online) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 z-[60] flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <WifiOff size={16} aria-hidden="true" className="shrink-0" />
      <span>You’re offline. You can look around, but changes can’t be saved until you’re back.</span>
    </div>
  )
}
