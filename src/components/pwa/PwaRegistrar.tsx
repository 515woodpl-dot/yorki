'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { startInstallCapture } from './install-store'

const BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''
const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * Registers the service worker (production only) and offers updates.
 * A new version never replaces the old one mid-use: a small bar asks the person to refresh.
 */
export function PwaRegistrar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    startInstallCapture()
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return

    let reloading = false
    let userAsked = false
    const onControllerChange = () => {
      // Only reload when the person asked for the update (not on the very first install).
      if (userAsked && !reloading) { reloading = true; window.location.reload() }
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    ;(window as Window & { __yorkiApplyUpdate?: () => void }).__yorkiApplyUpdate = () => { userAsked = true }

    let registration: ServiceWorkerRegistration | undefined
    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker)
        })
      })
    }

    navigator.serviceWorker
      .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
      .then((reg) => { registration = reg; watch(reg) })
      .catch(() => { /* never let this affect the app */ })

    // Installed apps can stay open for days: look for updates now and then, and when reopened.
    const check = () => { registration?.update().catch(() => {}) }
    const timer = window.setInterval(check, UPDATE_CHECK_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  if (!waiting) return null
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card p-3 pl-4 shadow-xl lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0"
    >
      <RefreshCw size={16} aria-hidden="true" className="shrink-0 text-primary" />
      <p className="flex-1 text-sm text-foreground">A new version of Yorki is ready.</p>
      <button
        type="button"
        onClick={() => {
          ;(window as Window & { __yorkiApplyUpdate?: () => void }).__yorkiApplyUpdate?.()
          waiting.postMessage({ type: 'SKIP_WAITING' })
        }}
        className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Refresh
      </button>
    </div>
  )
}
