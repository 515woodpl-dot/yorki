import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { getArchive } from '@/lib/actions/tasks'
import ArchiveClient from './ArchiveClient'
import { getActiveColumns } from '@/lib/local-data'

export default async function ArchivePage() {
  const user = await getSessionUser()
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    redirect('/dashboard')
  }

  const cols    = await getActiveColumns()
  const columns = cols.map(({ id, name }) => ({ id, name }))
  const { tasks, total } = await getArchive()

  return (
    <div className="flex-1 flex flex-col">
      <div className="max-w-4xl w-full mx-auto px-4 py-8 pb-24 sm:pb-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold">Archive</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total} archived {total === 1 ? 'task' : 'tasks'}
          </p>
        </div>
        <ArchiveClient
          initialTasks={tasks}
          columns={columns}
          isSuperAdmin={user.role === 'admin' || user.role === 'super_admin'}
        />
      </div>
    </div>
  )
}
