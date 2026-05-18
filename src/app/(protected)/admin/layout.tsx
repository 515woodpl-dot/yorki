import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSessionUser } from '@/lib/auth'
import { Mail, Columns3, Users, History } from 'lucide-react'

const adminNav = [
  { href: '/admin/activity', label: 'Activity', icon: History },
  { href: '/admin/email',   label: 'Email',   icon: Mail },
  { href: '/admin/columns', label: 'Columns', icon: Columns3 },
  { href: '/admin/users',   label: 'Users',   icon: Users },
]

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    redirect('/dashboard')
  }

  return (
    <div className="flex-1 flex flex-col sm:flex-row max-w-6xl w-full mx-auto px-4 py-8 gap-8 pb-24 sm:pb-8">
      <aside className="sm:w-52 shrink-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
          Settings
        </p>
        <nav className="space-y-0.5">
          {adminNav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Icon size={15} />
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
