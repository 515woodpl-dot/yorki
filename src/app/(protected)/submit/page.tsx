import { getSessionUser } from '@/lib/auth'
import { getAllUsers } from '@/lib/local-data'
import SubmitForm from './SubmitForm'

export default async function SubmitPage() {
  const user = await getSessionUser()
  const staffUsers = (await getAllUsers()).filter((entry) => entry.is_active && entry.role !== 'super_admin')
  return (
    <div className="flex-1 flex flex-col">
      <div className="max-w-2xl w-full mx-auto px-4 py-8 pb-24 sm:pb-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">New Request</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Submitting as <span className="font-medium text-foreground">
              {user?.full_name ?? user?.email}
            </span>
          </p>
        </div>

        <SubmitForm staffUsers={staffUsers} />
      </div>
    </div>
  )
}
