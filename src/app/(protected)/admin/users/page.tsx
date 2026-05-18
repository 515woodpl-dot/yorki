import { getSessionUser } from '@/lib/auth'
import { getAllUsersAction } from '@/lib/actions/settings'
import UsersClient from './UsersClient'

export default async function UsersPage() {
  const [users, currentUser] = await Promise.all([
    getAllUsersAction(),
    getSessionUser(),
  ])

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Users</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {users.length} {users.length === 1 ? 'user' : 'users'} in your workspace
      </p>
      <UsersClient
        initialUsers={users}
        isSuperAdmin={currentUser?.role === 'admin' || currentUser?.role === 'super_admin'}
      />
    </div>
  )
}
