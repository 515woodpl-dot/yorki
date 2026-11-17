export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AppNav from '@/components/layout/AppNav'
import SessionTimeout from '@/components/auth/SessionTimeout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <SessionTimeout />
      <AppNav user={user} />
      <main className="min-w-0 flex-1 flex flex-col pb-[calc(5.25rem+env(safe-area-inset-bottom))] [@media(max-height:500px)]:pb-[calc(3.75rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:pb-0 lg:pl-56 lg:pr-0">
        {children}
      </main>
    </div>
  )
}
