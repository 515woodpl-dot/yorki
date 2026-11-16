'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { LayoutDashboard, Plus, Archive, Settings, LogOut, ChevronDown, CalendarDays, CheckSquare, Users } from 'lucide-react'
import { cn, getUserInitials, getUserDisplayName } from '@/lib/utils'
import type { SessionUser } from '@/lib/types'
import NotificationBell from './NotificationBell'

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''
const mainLinks = [
  { href: '/dashboard?scope=mine&view=list', label: 'My tasks', icon: CheckSquare, key: 'mine' },
  { href: '/dashboard?view=board', label: 'Team board', icon: LayoutDashboard, key: 'board' },
  { href: '/dashboard?view=calendar', label: 'Calendar', icon: CalendarDays, key: 'calendar' },
]

export default function AppNav({ user }: { user: SessionUser }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  const active = pathname !== '/dashboard' ? pathname : searchParams.get('scope') === 'mine' ? 'mine' : searchParams.get('view') === 'calendar' ? 'calendar' : 'board'
  const navClass = (selected: boolean) => cn('flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors', selected ? 'bg-blue-100/70 text-primary dark:bg-primary/15' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')

  async function handleSignOut() {
    setSigningOut(true)
    try {
      const response = await fetch(`${APP_BASE_PATH}/signout`, { method: 'POST' })
      if (!response.ok) throw new Error('Sign out failed')
      router.push('/login')
      router.refresh()
    } catch {
      setSigningOut(false)
      window.alert('Could not sign out. Please try again.')
    }
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
        <button disabled={signingOut} onClick={handleSignOut} className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"><LogOut size={17} />{signingOut ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </details>
  )

  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-border/70 bg-card lg:flex">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-6 pb-9 pt-8"><Brand /><span><span className="block text-2xl font-bold tracking-tight">Yorki</span><span className="block text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Golden Stone Works</span></span></Link>
      <nav aria-label="Main navigation" className="space-y-1 px-4">
        {mainLinks.map(({ href, label, icon: Icon, key }) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined} className={navClass(active === key)}><Icon size={19} />{label}</Link>)}
        {isAdmin && <Link href="/archive" aria-current={active === '/archive' ? 'page' : undefined} className={navClass(active === '/archive')}><Archive size={19} />Archive</Link>}
      </nav>
      <div className="mx-6 my-6 border-t border-border/70" />
      {isAdmin && <nav aria-label="Administration" className="space-y-1 px-4"><p className="mb-3 px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Administration</p><Link href="/admin/users" className={navClass(active.startsWith('/admin/users'))}><Users size={19} />Users</Link><Link href="/admin/settings" className={navClass(active.startsWith('/admin') && !active.startsWith('/admin/users'))}><Settings size={19} />Settings</Link></nav>}
      <div className="mx-4 mt-6"><Link href="/submit" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"><Plus size={18} />New task</Link></div>
      <div className="mt-auto border-t border-border/70 p-4"><NotificationBell />{accountMenu(true)}</div>
    </aside>
    <header className="sticky top-0 z-40 flex h-[72px] items-center justify-between border-b border-border/60 bg-card/95 px-5 backdrop-blur lg:hidden">
      <Link href="/dashboard" className="flex items-center gap-2"><Brand /><span><span className="block text-xl font-bold leading-6 tracking-tight">Yorki</span><span className="text-[8px] font-semibold uppercase tracking-widest text-muted-foreground">Golden Stone Works</span></span></Link><div className="flex items-center"><NotificationBell />{accountMenu(false)}</div>
    </header>
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {[...mainLinks.slice(0, 2), { href: '/submit', label: 'New task', icon: Plus, key: '/submit' }, mainLinks[2]].map(({ href, label, icon: Icon, key }) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined} className={cn('my-2 flex min-h-[50px] flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium', active === key ? 'bg-blue-100/70 text-primary dark:bg-primary/15' : 'text-muted-foreground')}><Icon size={20} />{label === 'Team board' ? 'Board' : label}</Link>)}
    </nav>
  </>
}

function Brand() {
  return <span aria-hidden="true" className="flex h-10 w-8 shrink-0 items-center justify-center text-[36px] font-black tracking-tighter text-primary">Y<span className="mb-5 -ml-1 h-2 w-2 rounded-sm bg-[#6A97C4]" /></span>
}

export function Avatar({ user, size = 'md' }: {
  user: { avatar_url?: string | null; full_name?: string | null; display_name?: string | null; email?: string | null }
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-9 w-9 text-sm' }[size]
  if (user.avatar_url) return <img src={user.avatar_url} alt={getUserDisplayName(user)} className={cn(sizeClass, 'rounded-full object-cover')} />
  return <span className={cn(sizeClass, 'inline-flex shrink-0 items-center justify-center rounded-full border border-primary/10 bg-primary/10 font-semibold text-primary')}>{getUserInitials(user.full_name ?? user.display_name ?? user.email)}</span>
}
