import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { getBoardData } from '@/lib/actions/tasks'
import KanbanBoard from '@/components/board/KanbanBoard'

export const revalidate = 0

export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { columns, currentUser } = await getBoardData()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <KanbanBoard initialColumns={columns} currentUser={currentUser} />
    </div>
  )
}
