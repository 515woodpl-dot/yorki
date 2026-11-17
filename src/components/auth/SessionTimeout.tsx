'use client'

import { useEffect, useRef } from 'react'

const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const REFRESH_THROTTLE_MS = 60 * 1000
const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

export default function SessionTimeout() {
  const timeoutRef = useRef<number | undefined>(undefined)
  const lastRefreshRef = useRef(0)
  const signingOutRef = useRef(false)

  useEffect(() => {
    const signOutForInactivity = async () => {
      if (signingOutRef.current) return
      signingOutRef.current = true
      try {
        await fetch(`${APP_BASE_PATH}/signout`, { method: 'POST', keepalive: true })
      } finally {
        window.location.assign(`${APP_BASE_PATH}/login?reason=timeout`)
      }
    }

    const scheduleTimeout = () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      timeoutRef.current = window.setTimeout(() => { void signOutForInactivity() }, IDLE_TIMEOUT_MS)
    }

    const recordActivity = () => {
      scheduleTimeout()
      const now = Date.now()
      if (now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return
      lastRefreshRef.current = now
      void fetch(`${APP_BASE_PATH}/api/session/refresh`, { method: 'POST', keepalive: true })
        .then((response) => { if (!response.ok) void signOutForInactivity() })
        .catch(() => undefined)
    }

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    events.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }))
    scheduleTimeout()

    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      events.forEach((event) => window.removeEventListener(event, recordActivity))
    }
  }, [])

  return null
}
