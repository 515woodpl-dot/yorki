export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AppShell from '@/components/layout/AppShell'
import { NAV_COOKIE } from '@/lib/nav-prefs'
import SessionTimeout from '@/components/auth/SessionTimeout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const navCollapsed = (await cookies()).get(NAV_COOKIE)?.value === 'collapsed'

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <SessionTimeout />
      <AppShell user={user} initialCollapsed={navCollapsed}>{children}</AppShell>
    </div>
  )
}
