'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Columns3, History, Mail, Settings2, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { href: '/admin/settings', label: 'General', icon: Settings2 },
  { href: '/admin/activity', label: 'Activity', icon: History },
  { href: '/admin/email', label: 'Email', icon: Mail },
  { href: '/admin/columns', label: 'Columns', icon: Columns3 },
  { href: '/admin/users', label: 'Users', icon: Users },
]

export default function AdminNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Administration" className="mb-8 border-b border-border/70 sm:mb-10">
      <div className="flex gap-1 overflow-x-auto pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('relative flex min-h-12 shrink-0 items-center gap-2 rounded-t-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 sm:px-4', active ? 'text-primary' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground')}>
              <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />{label}
              {active && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
