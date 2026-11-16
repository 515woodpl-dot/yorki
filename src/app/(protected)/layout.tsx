export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AppNav from '@/components/layout/AppNav'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppNav user={user} />
      <main className="flex-1 flex flex-col pb-20 sm:pb-0">
        {children}
      </main>
    </div>
  )
}
