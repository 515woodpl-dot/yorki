'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { startInstallCapture } from './install-store'

const BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''
const UPDATE_CHECK_MS = 60 * 60 * 1000
const LONG_SUSPEND_MS = 5 * 60 * 1000

/**
 * Registers the service worker (production only) and offers updates.
 * A new version never replaces the old one mid-use: a small bar asks the person to refresh.
 */
export function PwaRegistrar() {
  const router = useRouter()
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  // Tapping a push notification while Yorki is open: the service worker asks us to go to that card.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: unknown } | null
      if (data?.type === 'navigate' && typeof data.path === 'string' && /^\/(?!\/)/.test(data.path)) router.push(data.path)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [router])

  useEffect(() => {
    startInstallCapture()
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return

    let reloading = false
    let userAsked = false
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null
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
    const check = async () => {
      try {
        await registration?.update()
        if (registration?.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting)
      } catch { /* offline or waking up; the next check retries */ }
    }
    const forceRefresh = async () => {
      try {
        const reg = registration ?? await navigator.serviceWorker.getRegistration(`${BASE_PATH}/`)
        await reg?.update()
        if (reg?.waiting) {
          userAsked = true
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          return
        }
      } catch { /* a normal reload still fetches the current app */ }
      window.location.reload()
    }
    window.addEventListener('yorki:force-refresh', forceRefresh)
    const timer = window.setInterval(check, UPDATE_CHECK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      const wasSuspended = hiddenAt !== null && Date.now() - hiddenAt >= LONG_SUSPEND_MS
      hiddenAt = null
      void check()
      // Revalidate server components after the OS has frozen the installed app for a while.
      // This repairs stale/blank restored views without throwing away the current URL.
      if (wasSuspended && navigator.onLine) router.refresh()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && navigator.onLine) {
        void check()
        router.refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('yorki:force-refresh', forceRefresh)
      window.clearInterval(timer)
    }
  }, [router])

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
