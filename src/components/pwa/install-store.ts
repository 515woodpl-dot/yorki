'use client'

import { useSyncExternalStore } from 'react'

/**
 * "Install app" support. Chrome / Edge / Android fire `beforeinstallprompt` once, early —
 * possibly before the menu that offers the button exists — so it's captured here, at the
 * app root, and read later. (iPhone/iPad Safari has no such event; see InstallAppItem.)
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let started = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export function startInstallCapture() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault() // keep it for our own button instead of the browser's mini-bar
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export function useInstallPrompt(): BeforeInstallPromptEvent | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => deferred,
    () => null,
  )
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable'
  const event = deferred
  deferred = null // the browser allows one prompt per event
  notify()
  await event.prompt()
  return (await event.userChoice).outcome
}

/** Already running as an installed app? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ pretends to be a Mac; a Mac with a touch screen is an iPad.
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
