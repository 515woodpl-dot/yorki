'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionUser } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NAV_COOKIE } from '@/lib/nav-prefs'
import AppNav from './AppNav'

const OPEN_DELAY = 120   // ms: brushing past the menu shouldn't open it
const CLOSE_DELAY = 250  // ms: a quick wobble outside shouldn't close it

/**
 * The app frame: side menu plus the page. On desktop the menu sits as a narrow
 * icon rail, opens over the page while the mouse is on it, and closes when the
 * mouse leaves. Pinning keeps it open (and pushes the page over).
 */
export default function AppShell({ user, initialPinned, children }: { user: SessionUser; initialPinned: boolean; children: React.ReactNode }) {
  const [pinned, setPinned] = useState(initialPinned)
  const [peek, setPeek] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const schedule = useCallback((open: boolean) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setPeek(open), open ? OPEN_DELAY : CLOSE_DELAY)
  }, [])

  const togglePinned = useCallback(() => {
    clearTimeout(timer.current)
    setPeek(false)
    setPinned((value) => {
      const next = !value
      // A cookie (not localStorage) so the server draws the right width on the next load, with no jump.
      document.cookie = `${NAV_COOKIE}=${next ? 'pinned' : 'auto'}; path=/; max-age=31536000; samesite=lax`
      return next
    })
  }, [])

  return <>
    <AppNav
      user={user}
      collapsed={!pinned && !peek}
      pinned={pinned}
      onTogglePinned={togglePinned}
      onPointerEnterMenu={() => { if (!pinned) schedule(true) }}
      onPointerLeaveMenu={() => { if (!pinned) schedule(false) }}
    />
    <main className={cn('min-w-0 flex-1 flex flex-col pb-[calc(5.25rem+env(safe-area-inset-bottom))] [@media(max-height:500px)]:pb-[calc(3.75rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:pb-0 lg:pr-0 lg:transition-[padding] lg:duration-200', pinned ? 'lg:pl-56' : 'lg:pl-[4.5rem]')}>
      {children}
    </main>
  </>
}
