'use client'

import { useEffect, useState } from 'react'

const SESSION_KEY = 'yorki-boot-gate-seen'
const MIN_GATE_MS = 3000
const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

export function AppBootGate({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const getSeen = () => {
      try {
        return window.sessionStorage.getItem(SESSION_KEY) === '1'
      } catch {
        return false
      }
    }

    const markSeen = () => {
      try {
        window.sessionStorage.setItem(SESSION_KEY, '1')
      } catch {
        // Ignore storage failures in private/locked-down browsers.
      }
    }

    if (getSeen()) {
      setIsReady(true)
      return
    }

    const timer = window.setTimeout(() => {
      markSeen()
      setIsReady(true)
    }, MIN_GATE_MS)

    return () => window.clearTimeout(timer)
  }, [])

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F3EE] px-6 text-[#2F3650]">
        <div className="flex flex-col items-center gap-6 text-center">
          <img
            src={`${APP_BASE_PATH}/Yorki.png`}
            alt="Yorki"
            className="h-auto w-[220px]"
          />
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#6A97C4]">Loading workspace</p>
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-[#D9E2EE]">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-[#A6784A]" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
