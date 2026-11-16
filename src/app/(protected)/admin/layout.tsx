import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import AdminNav from './AdminNav'

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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-24 pt-6 sm:px-8 sm:pb-10 sm:pt-8">
      <AdminNav />
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}
