'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { LayoutDashboard, PlusSquare, Archive, Settings, LogOut, ChevronDown } from 'lucide-react'
import { cn, getUserInitials, getUserDisplayName } from '@/lib/utils'
import type { SessionUser } from '@/lib/types'

interface Props { user: SessionUser }

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

const staffLinks = [
  { href: '/dashboard', label: 'Board',    icon: LayoutDashboard },
  { href: '/submit',    label: 'Submit',   icon: PlusSquare },
]
const adminLinks = [
  { href: '/dashboard',      label: 'Board',    icon: LayoutDashboard },
  { href: '/submit',         label: 'Submit',   icon: PlusSquare },
  { href: '/archive',        label: 'Archive',  icon: Archive },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

export default function AppNav({ user }: Props) {
  const pathname = usePathname()
  const router   = useRouter()

  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  const links   = isAdmin ? adminLinks : staffLinks

  async function handleSignOut() {
    await fetch('/signout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Desktop nav */}
      <header className={cn(
        'hidden sm:flex h-[52px] sticky top-0 z-40 items-center px-5 gap-6',
        'border-b border-border bg-card/90 backdrop-blur-md'
      )}>
        {/* Logo */}
        <Link href="/dashboard" className="shrink-0 flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${APP_BASE_PATH}/Yorki.png`} alt="Yorki" className="h-6 w-auto object-contain" />
        </Link>

        {/* Divider */}
        <div className="w-px h-4 bg-border shrink-0" />

        {/* Nav links */}
        <nav className="flex items-center gap-0.5 flex-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium tracking-wide transition-all duration-150',
                isActive(href)
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
              )}
            >
              <Icon size={13} strokeWidth={isActive(href) ? 2.2 : 1.8} />
              {label}
            </Link>
          ))}
        </nav>

        {/* Right */}
        <div className="flex items-center gap-1.5">
          <UserMenu user={user} onSignOut={handleSignOut} />
        </div>
      </header>

      {/* Mobile top bar */}
      <header className="sm:hidden relative flex h-[52px] sticky top-0 z-40 items-center justify-center px-4 border-b border-border bg-card/90 backdrop-blur-md">
        <Link href="/dashboard" className="flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${APP_BASE_PATH}/Yorki.png`} alt="Yorki" className="h-9 w-auto object-contain" />
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="absolute right-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          aria-label="Sign out"
        >
          <LogOut size={16} />
        </button>
      </header>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="flex">
          {links.slice(0, 4).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-medium tracking-wide transition-colors',
                isActive(href) ? 'text-primary' : 'text-muted-foreground'
              )}>
              <Icon size={19} strokeWidth={isActive(href) ? 2.2 : 1.7} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  )
}

function UserMenu({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-accent/60 transition-colors">
        <Avatar user={user} size="sm" />
        <span className="text-xs font-medium text-foreground hidden lg:block max-w-[100px] truncate">
          {getUserDisplayName(user)}
        </span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1.5 w-52 bg-card border border-border rounded-xl shadow-xl z-20 py-1.5 animate-scale-in">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs font-semibold text-foreground truncate">{getUserDisplayName(user)}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{user.email}</p>
              <span className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-semibold uppercase tracking-wider">
                {user.role.replace('_', ' ')}
              </span>
            </div>
            <button onClick={() => { setOpen(false); onSignOut() }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-destructive hover:bg-destructive/8 transition-colors mt-0.5">
              <LogOut size={12} />Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function Avatar({ user, size = 'md' }: {
  user: { avatar_url?: string | null; full_name?: string | null; display_name?: string | null; email?: string | null }
  size?: 'sm' | 'md' | 'lg'
}) {
  const initials  = getUserInitials(user.full_name ?? user.display_name ?? user.email)
  const sizeClass = { sm: 'w-5 h-5 text-[10px]', md: 'w-7 h-7 text-xs', lg: 'w-9 h-9 text-sm' }[size]

  if (user.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={user.avatar_url} alt={getUserDisplayName(user)} className={cn(sizeClass, 'rounded-full object-cover')} />
    )
  }

  return (
    <div className={cn(sizeClass, 'rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0 ring-1 ring-primary/20')}>
      {initials}
    </div>
  )
}
