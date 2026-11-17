'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { LayoutDashboard, Plus, Archive, Settings, LogOut, ChevronDown, CalendarDays, CheckSquare, Users, Bell } from 'lucide-react'
import { cn, getUserInitials, getUserDisplayName } from '@/lib/utils'
import type { SessionUser } from '@/lib/types'
import BrandLogo from '@/components/brand/BrandLogo'
import NotificationBell from './NotificationBell'
import InstallAppItem from '@/components/pwa/InstallAppItem'
import { removeThisDevicePush } from '@/lib/push/client'

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''
const mainLinks = [
  { href: '/dashboard?scope=mine&view=list', label: 'My tasks', icon: CheckSquare, key: 'mine' },
  { href: '/dashboard?view=board', label: 'Team board', icon: LayoutDashboard, key: 'board' },
  { href: '/dashboard?view=calendar', label: 'Calendar', icon: CalendarDays, key: 'calendar' },
]

export default function AppNav({ user }: { user: SessionUser }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [signingOut, setSigningOut] = useState(false)
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  const active = pathname !== '/dashboard' ? pathname : searchParams.get('scope') === 'mine' ? 'mine' : searchParams.get('view') === 'calendar' ? 'calendar' : 'board'
  const navClass = (selected: boolean) => cn('flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors', selected ? 'bg-[#dceaff] text-[#174c98] dark:bg-primary/20 dark:text-blue-200' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')

  /** The form posts natively (works even if scripts are broken). With scripts, we first stop alerts on this device. */
  async function handleSignOut(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setSigningOut(true)
    try { await removeThisDevicePush() } catch { /* signing out comes first */ }
    form.submit()
  }

  const accountMenu = (desktop: boolean) => (
    <details className="relative group/account">
      <summary aria-label="Account menu" className={cn('flex cursor-pointer list-none items-center gap-2 rounded-xl p-2 hover:bg-accent/60 [&::-webkit-details-marker]:hidden', desktop && 'w-full')}>
        <Avatar user={user} size="lg" />
        {desktop && <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{getUserDisplayName(user)}</span><span className="block text-xs text-muted-foreground">{isAdmin ? 'Administrator' : 'Team member'}</span></span>}
        {desktop && <ChevronDown size={14} className="text-muted-foreground" />}
      </summary>
      <div className={cn('absolute z-50 w-60 rounded-2xl border border-border bg-card p-2 shadow-xl', desktop ? 'bottom-full left-0 mb-2' : 'right-0 top-full mt-2')}>
        <p className="truncate px-3 py-2 text-xs text-muted-foreground">{user.email}</p>
        {isAdmin && <><Link href="/admin/users" className={navClass(false)}><Users size={17} />Manage users</Link><Link href="/admin/settings" className={navClass(false)}><Settings size={17} />Settings</Link><Link href="/archive" className={navClass(false)}><Archive size={17} />Archive</Link></>}
        <Link href="/notifications" className={navClass(false)}><Bell size={17} />Notification settings</Link>
        <InstallAppItem className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground" />
        <form method="post" action={`${APP_BASE_PATH}/signout`} onSubmit={handleSignOut}><button type="submit" disabled={signingOut} className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"><LogOut size={17} />{signingOut ? 'Signing out…' : 'Sign out'}</button></form>
      </div>
    </details>
  )

  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-blue-200/70 bg-gradient-to-b from-[#f6faff] via-[#eaf3ff] to-[#dceaff] shadow-[4px_0_24px_-14px_rgba(35,67,115,0.3)] dark:border-border dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 lg:flex">
      <Link href="/dashboard" className="px-6 pb-9 pt-8"><Brand /></Link>
      <nav aria-label="Main navigation" className="space-y-1 px-4">
        {mainLinks.map(({ href, label, icon: Icon, key }) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined} className={navClass(active === key)}><Icon size={19} />{label}</Link>)}
        {isAdmin && <Link href="/archive" aria-current={active === '/archive' ? 'page' : undefined} className={navClass(active === '/archive')}><Archive size={19} />Archive</Link>}
      </nav>
      <div className="mx-6 my-6 border-t border-blue-200/80 dark:border-border" />
      {isAdmin && <nav aria-label="Administration" className="space-y-1 px-4"><p className="mb-3 px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Administration</p><Link href="/admin/users" className={navClass(active.startsWith('/admin/users'))}><Users size={19} />Users</Link><Link href="/admin/settings" className={navClass(active.startsWith('/admin') && !active.startsWith('/admin/users'))}><Settings size={19} />Settings</Link></nav>}
      <div className="mx-4 mt-6"><Link href="/submit" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#24457f] to-[#367caf] px-4 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition-opacity hover:opacity-90"><Plus size={18} />New task</Link></div>
      <div className="mt-auto border-t border-blue-200/80 p-4 dark:border-border"><NotificationBell />{accountMenu(true)}</div>
    </aside>
    <header className="sticky top-0 z-40 flex h-[calc(72px+env(safe-area-inset-top))] [@media(max-height:500px)]:h-[calc(52px+env(safe-area-inset-top))] items-center justify-between border-b border-border/60 bg-card/95 pb-0 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
      <Link href="/dashboard" className="flex items-center"><Brand /></Link><div className="flex items-center"><NotificationBell />{accountMenu(false)}</div>
    </header>
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] backdrop-blur lg:hidden">
      {[...mainLinks.slice(0, 2), { href: '/submit', label: 'New task', icon: Plus, key: '/submit' }, mainLinks[2]].map(({ href, label, icon: Icon, key }) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined} className={cn('my-2 [@media(max-height:500px)]:my-1 flex min-h-[50px] [@media(max-height:500px)]:min-h-11 flex-col [@media(max-height:500px)]:flex-row items-center justify-center gap-1 [@media(max-height:500px)]:gap-2 rounded-xl text-[10px] [@media(max-height:500px)]:text-xs font-medium', active === key ? 'bg-blue-100/70 text-primary dark:bg-primary/15' : 'text-muted-foreground')}><Icon size={20} />{label === 'Team board' ? 'Board' : label}</Link>)}
    </nav>
  </>
}

function Brand() {
  return <BrandLogo className="h-10" />
}

export function Avatar({ user, size = 'md' }: {
  user: { avatar_url?: string | null; full_name?: string | null; display_name?: string | null; email?: string | null }
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-9 w-9 text-sm' }[size]
  if (user.avatar_url) return <img src={user.avatar_url} alt={getUserDisplayName(user)} className={cn(sizeClass, 'rounded-full object-cover')} />
  return <span className={cn(sizeClass, 'inline-flex shrink-0 items-center justify-center rounded-full border border-primary/10 bg-primary/10 font-semibold text-primary')}>{getUserInitials(user.full_name ?? user.display_name ?? user.email)}</span>
}
