'use client'

/**
 * Browser-side live collaboration helpers.
 *
 * useLiveEvents: one shared /api/board/stream connection per tab. Emits
 *   'board' | 'presence' | 'notifications' | 'resync'. Reconnects
 *   automatically and resyncs when the tab regains focus / network returns.
 * useBoardStream: the board's view of it (ignores notification events).
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

export type LiveEventKind = 'board' | 'presence' | 'notifications' | 'resync'
type LiveListener = (info: { kind: LiveEventKind }) => void

// One EventSource per tab, shared by the board and the notification bell.
const liveListeners = new Set<LiveListener>()
let liveTeardown: (() => void) | null = null

function emitLive(kind: LiveEventKind) {
  for (const listener of Array.from(liveListeners)) listener({ kind })
}

function startLiveConnection() {
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let hadError = false

  const connect = () => {
    if (disposed) return
    source = new EventSource(`${APP_BASE_PATH}/api/board/stream`)
    source.addEventListener('change', (event) => {
      let kind: LiveEventKind = 'board'
      try {
        const parsed = JSON.parse((event as MessageEvent).data).kind
        if (parsed === 'presence' || parsed === 'notifications') kind = parsed
      } catch { /* default */ }
      emitLive(kind)
    })
    source.addEventListener('open', () => {
      // After a drop we may have missed events: resync once.
      if (hadError) emitLive('resync')
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
    if (document.visibilityState === 'visible') emitLive('resync')
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
}

/** Subscribe to live events. The shared connection opens with the first subscriber. */
export function useLiveEvents(onEvent: LiveListener) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
    const listener: LiveListener = (info) => onEventRef.current(info)
    liveListeners.add(listener)
    if (!liveTeardown) liveTeardown = startLiveConnection()
    return () => {
      liveListeners.delete(listener)
      if (liveListeners.size === 0 && liveTeardown) {
        liveTeardown()
        liveTeardown = null
      }
    }
  }, [])
}

/** Board changes (cards, presence) — ignores notification-only events. */
export function useBoardStream(onChange: (info: { kind: LiveEventKind }) => void) {
  useLiveEvents((info) => {
    if (info.kind !== 'notifications') onChange(info)
  })
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
