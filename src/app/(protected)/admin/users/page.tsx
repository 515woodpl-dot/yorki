import Link from 'next/link'
import { getSessionUser } from '@/lib/auth'
import { getAllUsersAction, getUserCategoryAccess } from '@/lib/actions/settings'
import { BASE_PATH } from '@/lib/form-post'
import { DEFAULT_BOARD_ID, getActiveColumns } from '@/lib/local-data'
import { getUserDisplayName } from '@/lib/utils'

const input = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'
const primary = 'h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90'
const quiet = 'inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:bg-accent'

function Post({ children, className }: { children: React.ReactNode; className?: string }) {
  return <form method="post" action={`${BASE_PATH}/admin/users/action`} className={className}>{children}</form>
}

/**
 * Plain server-rendered page: every change is a form with a visible button, and the page
 * answers with a message. Nothing here depends on client-side JavaScript.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; password?: string; delete?: string }>
}) {
  const { notice, error, password, delete: deleting } = await searchParams
  const [users, me, categories, categoryAccess] = await Promise.all([
    getAllUsersAction(), getSessionUser(), getActiveColumns(DEFAULT_BOARD_ID, false), getUserCategoryAccess(),
  ])
  const passwordFor = users.find((u) => u.id === password)
  const deleteFor = users.find((u) => u.id === deleting)

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold">Users</h1>
      <p className="mb-5 text-sm text-muted-foreground">{users.length} {users.length === 1 ? 'user' : 'users'} in your workspace</p>

      {notice && <p role="status" className="mb-4 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">{notice}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {passwordFor && (
        <Post className="mb-4 space-y-3 rounded-xl border border-primary/30 bg-card p-4">
          <input type="hidden" name="op" value="password" /><input type="hidden" name="id" value={passwordFor.id} />
          <h2 className="text-sm font-semibold">Set password for {getUserDisplayName(passwordFor)}</h2>
          <div className="flex gap-2">
            <input name="password" type="text" autoComplete="off" required minLength={8} placeholder="At least 8 characters" className={input} />
            <button type="submit" className={primary}>Save password</button>
            <Link href="/admin/users" className={quiet}>Cancel</Link>
          </div>
        </Post>
      )}

      {deleteFor && (
        <Post className="mb-4 space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <input type="hidden" name="op" value="delete" /><input type="hidden" name="id" value={deleteFor.id} />
          <h2 className="text-sm font-semibold">Delete {getUserDisplayName(deleteFor)}?</h2>
          <p className="text-sm text-muted-foreground">This removes the account and every task they submitted or are assigned to, and hides their comments. It cannot be undone. To keep their work, deactivate the account instead.</p>
          <div className="flex gap-2">
            <button type="submit" className="h-10 rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">Yes, delete permanently</button>
            <Link href="/admin/users" className={quiet}>Cancel</Link>
          </div>
        </Post>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {users.map((user) => {
          const isMe = user.id === me?.id
          const locked = user.role === 'super_admin' && me?.role !== 'super_admin'
          const roleLabel = user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Admin' : 'Staff'
          return (
            <li key={user.id} className={`space-y-3 bg-card px-4 py-3 ${user.is_active ? '' : 'opacity-60'}`}>
              <div>
                <p className="text-sm font-medium">{getUserDisplayName(user)}{isMe && ' (you)'}{!user.is_active && <span className="ml-2 text-xs text-muted-foreground">inactive</span>}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {user.role === 'super_admin' || isMe || locked ? (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{roleLabel}</span>
                ) : (
                  <Post className="flex items-center gap-2">
                    <input type="hidden" name="op" value="role" /><input type="hidden" name="id" value={user.id} />
                    <select name="role" defaultValue={user.role} aria-label={`Role for ${getUserDisplayName(user)}`} className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button type="submit" className={primary}>Save role</button>
                  </Post>
                )}
                {!locked && <Link href={`/admin/users?password=${user.id}`} className={quiet}>Set password</Link>}
                {user.role !== 'super_admin' && !isMe && !locked && (
                  <>
                    <Post>
                      <input type="hidden" name="op" value="active" /><input type="hidden" name="id" value={user.id} /><input type="hidden" name="active" value={user.is_active ? '0' : '1'} />
                      <button type="submit" className={quiet}>{user.is_active ? 'Deactivate' : 'Activate'}</button>
                    </Post>
                    <Link href={`/admin/users?delete=${user.id}`} className={`${quiet} text-destructive`}>Delete…</Link>
                  </>
                )}
              </div>
               {user.role !== 'super_admin' && !isMe && !locked && (
                 <details className="rounded-lg border border-border/70 p-3">
                   <summary className="min-h-10 cursor-pointer text-xs font-medium">
                     Visible categories: {categoryAccess[user.id] === null ? 'All' : `${categoryAccess[user.id]?.length ?? 0} selected`}
                   </summary>
                   <Post className="mt-2 space-y-2">
                     <input type="hidden" name="op" value="categories" /><input type="hidden" name="id" value={user.id} />
                     <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="unrestricted" value="1" defaultChecked={categoryAccess[user.id] === null} /> Allow all categories</label>
                     <div className="grid gap-2 sm:grid-cols-2">
                       {categories.map((category) => (
                         <label key={category.id} className="flex items-center gap-2 text-xs">
                           <input type="checkbox" name="category" value={category.id} defaultChecked={categoryAccess[user.id]?.includes(category.id) ?? false} /> {category.name}
                         </label>
                       ))}
                     </div>
                     <button type="submit" className={primary}>Save category access</button>
                   </Post>
                 </details>
               )}
            </li>
          )
        })}
      </ul>

      <details className="mt-5 rounded-xl border border-dashed border-border p-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Add a user</summary>
        <Post className="mt-4 space-y-3">
          <input type="hidden" name="op" value="create" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium">Full name<input name="name" required placeholder="Jane Smith" className={input} /></label>
            <label className="space-y-1 text-xs font-medium">Email<input name="email" type="email" required placeholder="jane@company.com" className={input} /></label>
          </div>
          <label className="block space-y-1 text-xs font-medium">Role
            <select name="role" defaultValue="staff" className={`${input} sm:w-48`}><option value="staff">Staff</option><option value="admin">Admin</option></select>
          </label>
          <button type="submit" className={primary}>Create account</button>
        </Post>
      </details>
    </div>
  )
}
