import { revalidatePath } from 'next/cache'
import { getSessionUser } from '@/lib/auth'
import { isSameOrigin, seeOther } from '@/lib/form-post'
import { createUser, deleteUser, setUserPassword, toggleUserActive, updateUserRole } from '@/lib/actions/settings'

/**
 * Every button on the Users page posts here as a plain HTML form, then comes back to the page
 * with a visible message ("Saved" or the reason it was refused). No JavaScript needed.
 */
export async function POST(request: Request) {
  const back = (params: Record<string, string | undefined>) => seeOther('/admin/users', params)
  if (!isSameOrigin(request)) return back({ error: 'That request was blocked. Please try again.' })

  const user = await getSessionUser()
  if (!user) return seeOther('/login', { reason: 'timeout' })
  if (user.role !== 'admin' && user.role !== 'super_admin') return seeOther('/dashboard')

  const form = await request.formData().catch(() => null)
  const text = (name: string) => String(form?.get(name) ?? '').trim()
  const op = text('op')
  const id = text('id')

  let result: { success: boolean; error?: string } | undefined
  let notice = ''
  if (op === 'create') {
    const role = text('role') === 'admin' ? 'admin' : 'staff'
    result = await createUser(text('email'), text('name'), role)
    notice = `Account created for ${text('name')}. Now set their password (key icon) or send the invite.`
  } else if (op === 'role') {
    const role = text('role') === 'admin' ? 'admin' : 'staff'
    result = await updateUserRole(id, role)
    notice = `Role saved: ${role === 'admin' ? 'Admin' : 'Staff'}.`
  } else if (op === 'active') {
    const activate = text('active') === '1'
    result = await toggleUserActive(id, activate)
    notice = activate ? 'Account activated.' : 'Account deactivated. They can no longer sign in.'
  } else if (op === 'password') {
    result = await setUserPassword(id, String(form?.get('password') ?? ''))
    notice = 'Password saved. That person was signed out everywhere.'
  } else if (op === 'delete') {
    const deleted = await deleteUser(id)
    result = deleted
    if (deleted.success) {
      const count = deleted.data?.deletedTaskCount ?? 0
      notice = `Account deleted${count ? ` along with ${count} related task${count === 1 ? '' : 's'}` : ''}.`
    }
  } else {
    return back({ error: 'Unknown action.' })
  }

  revalidatePath('/admin/users')
  return result.success ? back({ notice }) : back({ error: result.error || 'Could not do that.' })
}
