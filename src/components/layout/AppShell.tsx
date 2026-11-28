'use client'

import { useCallback, useState } from 'react'
import type { SessionUser } from '@/lib/types'
import { cn } from '@/lib/utils'
import { NAV_COOKIE } from '@/lib/nav-prefs'
import AppNav from './AppNav'

/** The app frame: side menu (collapsible on desktop) plus the page. */
export default function AppShell({ user, initialCollapsed, children }: { user: SessionUser; initialCollapsed: boolean; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  const toggle = useCallback(() => {
    setCollapsed((value) => {
      const next = !value
      // A cookie (not localStorage) so the server draws the right width on the next load, with no jump.
      document.cookie = `${NAV_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
      return next
    })
  }, [])

  return <>
    <AppNav user={user} collapsed={collapsed} onToggleCollapsed={toggle} />
    <main className={cn('min-w-0 flex-1 flex flex-col pb-[calc(5.25rem+env(safe-area-inset-bottom))] [@media(max-height:500px)]:pb-[calc(3.75rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:pb-0 lg:pr-0 lg:transition-[padding] lg:duration-200', collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-56')}>
      {children}
    </main>
  </>
}
