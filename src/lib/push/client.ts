'use client'

/**
 * push/client.ts — the browser side of notifications: asking permission, subscribing this
 * device, unsubscribing. Everything here must be started by a tap (browsers and iPhone refuse
 * otherwise, and asking unprompted is rude).
 */

import { isIosDevice, isStandalone } from '@/components/pwa/install-store'

const BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

export type PushStatus =
  | 'checking'
  | 'dev'            // the service worker only runs in the production build
  | 'unsupported'    // this browser can't do push
  | 'needs-install'  // iPhone/iPad: only works once Yorki is added to the Home Screen
  | 'denied'         // the person blocked notifications for this site
  | 'off'            // can be turned on
  | 'on'

export interface DeviceInfo { id: string; label: string; created_at: string; last_success_at: string | null; failures: number }
export interface PushPrefsState { mention: boolean; comment: boolean; assigned: boolean; completed: boolean; show_preview: boolean }
export interface PushServerState { publicKey: string; prefs: PushPrefsState; devices: DeviceInfo[] }

const jsonHeaders = { 'Content-Type': 'application/json' }

export async function fetchPushState(): Promise<PushServerState> {
  const response = await fetch(`${BASE_PATH}/api/push/state`, { cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again.' : 'Could not load notification settings.')
  return response.json()
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

async function readyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return withTimeout(navigator.serviceWorker.ready, 5000)
}

/** What can this device do right now? */
export async function readPushStatus(): Promise<{ status: PushStatus; endpoint: string | null }> {
  if (typeof window === 'undefined') return { status: 'checking', endpoint: null }
  // iPhone/iPad Safari tabs don't offer push at all; installed apps do (iOS 16.4+).
  if (isIosDevice() && !isStandalone()) return { status: 'needs-install', endpoint: null }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { status: 'unsupported', endpoint: null }
  if (process.env.NODE_ENV !== 'production') return { status: 'dev', endpoint: null }
  if (Notification.permission === 'denied') return { status: 'denied', endpoint: null }
  const registration = await readyRegistration()
  if (!registration) return { status: 'unsupported', endpoint: null }
  const subscription = await registration.pushManager.getSubscription()
  return subscription && Notification.permission === 'granted'
    ? { status: 'on', endpoint: subscription.endpoint }
    : { status: 'off', endpoint: null }
}

const keyToBytes = (key: string) => {
  const padded = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

/** Ask permission, subscribe this device, tell the server. Throws a readable Error. */
export async function enablePush(publicKey: string): Promise<string> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications were blocked. You can allow them in your browser’s site settings.' : 'Notifications weren’t turned on.')
  const registration = await readyRegistration()
  if (!registration) throw new Error('The app isn’t ready yet. Reload the page and try again.')

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) })
    } catch {
      throw new Error('Couldn’t reach your browser’s notification service. Check your connection and try again.')
    }
  }
  const response = await fetch(`${BASE_PATH}/api/push/subscribe`, {
    method: 'POST', headers: jsonHeaders, credentials: 'same-origin', body: JSON.stringify(subscription.toJSON()),
  })
  if (!response.ok) {
    await subscription.unsubscribe().catch(() => {})
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'Could not save this device.')
  }
  return subscription.endpoint
}

/** Stop alerts on this device: tell the server first, then drop the browser's subscription. */
export async function disablePush(): Promise<void> {
  const registration = await readyRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  await fetch(`${BASE_PATH}/api/push/subscribe`, {
    method: 'DELETE', headers: jsonHeaders, credentials: 'same-origin', body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
}

/**
 * Called when signing out, so the next person to use this phone never receives the previous
 * person's alerts. Best effort and quick: it must never get in the way of signing out.
 */
export async function removeThisDevicePush(): Promise<void> {
  try {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    await withTimeout(disablePush(), 3000)
  } catch { /* signing out comes first */ }
}

/** Same value the server uses to name a device (first 16 hex chars of SHA-256 of the address). */
export async function endpointId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

export async function savePushPrefs(patch: Partial<PushPrefsState>): Promise<PushPrefsState> {
  const response = await fetch(`${BASE_PATH}/api/push/prefs`, { method: 'PUT', headers: jsonHeaders, credentials: 'same-origin', body: JSON.stringify(patch) })
  if (!response.ok) throw new Error('Could not save that.')
  return (await response.json()).prefs
}

export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(`${BASE_PATH}/api/push/test`, { method: 'POST', headers: jsonHeaders, credentials: 'same-origin', body: '{}' })
  const body = await response.json().catch(() => ({}))
  if (response.status === 429) return { ok: false, message: body.error || 'Please wait a few seconds.' }
  if (!response.ok && response.status !== 200) return { ok: false, message: body.error || 'Could not send the test.' }
  if (body.sent > 0) return { ok: true, message: body.sent === 1 ? 'Test sent. It should appear in a few seconds.' : `Test sent to ${body.sent} devices.` }
  return { ok: false, message: 'The test could not be delivered. Try turning notifications off and on again on this device.' }
}

export async function removeDevice(id: string): Promise<void> {
  const response = await fetch(`${BASE_PATH}/api/push/subscribe`, { method: 'DELETE', headers: jsonHeaders, credentials: 'same-origin', body: JSON.stringify({ id }) })
  if (!response.ok) throw new Error('Could not remove that device.')
}

/** Keep the app-icon badge (the little number) in step with the unread count. */
export function syncAppBadge(unread: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (!nav.setAppBadge || !nav.clearAppBadge) return
  ;(unread > 0 ? nav.setAppBadge(unread) : nav.clearAppBadge()).catch(() => {})
}
