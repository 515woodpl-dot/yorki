'use client'

/**
 * Browser-side live collaboration helpers.
 *
 * useBoardStream: listens to /api/board/stream and calls onChange when the
 *   board (or who's viewing what) changes. Reconnects automatically and also
 *   refreshes when the tab regains focus or the network comes back.
 * useTaskPresence: tells the server "this tab has card X open" (viewing or
 *   editing) with a heartbeat, and clears it on close.
 */

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { ActionResult, PresenceMode } from '@/lib/types'

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''
const PRESENCE_HEARTBEAT_MS = 15_000

let tabClientId: string | null = null
/** Stable id for this browser tab (presence is tracked per tab). */
export function getTabClientId() {
  if (!tabClientId) {
    tabClientId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
  return tabClientId
}

export function useBoardStream(onChange: (info: { kind: 'board' | 'presence' | 'resync' }) => void) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let hadError = false

    const connect = () => {
      if (disposed) return
      source = new EventSource(`${APP_BASE_PATH}/api/board/stream`)
      source.addEventListener('change', (event) => {
        let kind: 'board' | 'presence' = 'board'
        try { kind = JSON.parse((event as MessageEvent).data).kind === 'presence' ? 'presence' : 'board' } catch { /* default */ }
        onChangeRef.current({ kind })
      })
      source.addEventListener('open', () => {
        // After a drop we may have missed events: resync once.
        if (hadError) onChangeRef.current({ kind: 'resync' })
        hadError = false
      })
      source.addEventListener('error', () => {
        hadError = true
        // EventSource retries by itself unless the server refused (e.g. 401);
        // in that case readyState is CLOSED and we retry slowly.
        if (source?.readyState === EventSource.CLOSED) {
          source.close()
          clearTimeout(reconnectTimer)
          reconnectTimer = setTimeout(connect, 10_000)
        }
      })
    }

    const resync = () => {
      if (document.visibilityState === 'visible') onChangeRef.current({ kind: 'resync' })
    }

    connect()
    document.addEventListener('visibilitychange', resync)
    window.addEventListener('online', resync)
    return () => {
      disposed = true
      clearTimeout(reconnectTimer)
      source?.close()
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('online', resync)
    }
  }, [])
}

function sendPresence(taskId: string | null, mode: PresenceMode, { beacon = false } = {}) {
  const body = JSON.stringify({ clientId: getTabClientId(), taskId, mode })
  const url = `${APP_BASE_PATH}/api/board/presence`
  if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(url, body)
    return
  }
  fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {})
}

export function useTaskPresence(taskId: string | null, mode: PresenceMode) {
  useEffect(() => {
    if (!taskId) return
    sendPresence(taskId, mode)
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') sendPresence(taskId, mode)
    }, PRESENCE_HEARTBEAT_MS)
    const onHide = () => sendPresence(null, mode, { beacon: true })
    window.addEventListener('pagehide', onHide)
    return () => {
      clearInterval(heartbeat)
      window.removeEventListener('pagehide', onHide)
    }
  }, [taskId, mode])

  // Clear only when the card closes / changes (not on viewing↔editing switches).
  useEffect(() => {
    if (!taskId) return
    return () => sendPresence(null, 'viewing')
  }, [taskId])
}

/** Show a failed action: conflicts get a softer, longer-lived warning. */
export function reportActionFailure(result: Extract<ActionResult<unknown>, { success: false }>, fallback: string) {
  if (result.code === 'conflict') {
    toast.warning(result.error, { duration: 9000 })
  } else {
    toast.error(result.error || fallback)
  }
}
