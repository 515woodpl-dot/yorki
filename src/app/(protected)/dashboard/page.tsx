import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { getBoardData } from '@/lib/actions/tasks'
import { getAllUsers } from '@/lib/local-data'
import KanbanBoard from '@/components/board/KanbanBoard'

export const revalidate = 0

export default async function DashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { columns, currentUser, seq } = await getBoardData()

  // Who a card can be assigned to — the same people the New request form offers.
  const people = (await getAllUsers())
    .filter((entry) => entry.is_active && entry.role !== 'super_admin')
    .map((entry) => ({
      id: entry.id,
      name: entry.full_name ?? entry.display_name ?? entry.email ?? 'User',
      role: entry.role,
      aliases: [entry.display_name, entry.email?.split('@')[0]].filter((alias): alias is string => Boolean(alias)),
    }))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <KanbanBoard initialColumns={columns} currentUser={currentUser} initialSeq={seq} people={people} />
    </div>
  )
}
