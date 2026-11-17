'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { UserPlus, Loader2, ShieldCheck, User, Power, ChevronDown, KeyRound, X, Mail, Trash2 } from 'lucide-react'
import { createUser, updateUserRole, toggleUserActive, setUserPassword, deleteUser } from '@/lib/actions/settings'
import { resendInvite } from '@/lib/actions/invite'
import { cn, getUserDisplayName, getUserInitials } from '@/lib/utils'
import type { UserProfile } from '@/lib/types'

interface Props {
  initialUsers: UserProfile[]
  isSuperAdmin: boolean
}

export default function UsersClient({ initialUsers, isSuperAdmin }: Props) {
  const [users,     setUsers]    = useState(initialUsers)
  const [adding,    setAdding]   = useState(false)
  const [isPending, start]       = useTransition()
  const [pwUserId,  setPwUserId] = useState<string | null>(null)
  const [pwValue,   setPwValue]  = useState('')

  const [newEmail, setNewEmail] = useState('')
  const [newName,  setNewName]  = useState('')
  const [newRole,  setNewRole]  = useState<'staff' | 'admin'>('staff')

  async function handleCreateUser() {
    if (!newEmail.trim() || !newName.trim()) { toast.error('Name and email are required'); return }
    start(async () => {
      const result = await createUser(newEmail.trim(), newName.trim(), newRole)
      if (result.success) {
        toast.success(`Account created for ${newName}.`)
        setAdding(false); setNewEmail(''); setNewName(''); setNewRole('staff')
        window.location.reload()
      } else {
        toast.error(result.error)
      }
    })
  }

  async function handleRoleChange(userId: string, role: 'staff' | 'admin') {
    start(async () => {
      const result = await updateUserRole(userId, role)
      if (result.success) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
        toast.success('Role updated')
      } else toast.error(result.error)
    })
  }

  async function handleToggleActive(userId: string, current: boolean) {
    start(async () => {
      const result = await toggleUserActive(userId, !current)
      if (result.success) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: !current } : u))
        toast.success(current ? 'User deactivated' : 'User activated')
      } else toast.error(result.error)
    })
  }

  async function handleResendInvite(userId: string, email: string) {
    start(async () => {
      const result = await resendInvite(userId)
      if (result.success) {
        toast.success(`Invite sent to ${email}`)
        console.log('[Invite URL]', result.data?.url)
      } else {
        toast.error(result.error)
      }
    })
  }

  async function handleSetPassword() {
    if (!pwUserId || !pwValue.trim()) return
    start(async () => {
      const result = await setUserPassword(pwUserId, pwValue.trim())
      if (result.success) {
        toast.success('Password updated')
        setPwUserId(null); setPwValue('')
      } else toast.error(result.error)
    })
  }

  async function handleDeleteUser(userId: string, label: string) {
    if (!window.confirm(`Delete ${label} and remove every task they submitted or are assigned to? Their comments will also be removed from view. This cannot be undone.`)) return
    start(async () => {
      const result = await deleteUser(userId)
      if (result.success) {
        setUsers(prev => prev.filter(u => u.id !== userId))
        const count = result.data?.deletedTaskCount ?? 0
        toast.success(count === 1 ? 'User and 1 related task deleted' : `User and ${count} related tasks deleted`)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-4 max-w-2xl">

      {/* User list */}
      <div className="divide-y divide-border border border-border rounded-xl overflow-hidden">
        {users.map(user => (
          <div key={user.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 bg-card', !user.is_active && 'opacity-50')}>
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-semibold text-sm flex items-center justify-center shrink-0">
              {getUserInitials(user.full_name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground truncate">{getUserDisplayName(user)}</p>
                {!user.is_active && <span className="text-xs text-muted-foreground">(inactive)</span>}
              </div>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>

            {/* Role + actions: a second line under the name on phones, inline from `sm` up */}
            <div className="flex w-full items-center gap-1 pl-0 min-[360px]:pl-12 sm:w-auto sm:pl-0">
            <div className="mr-auto shrink-0 sm:mr-2">
              {isSuperAdmin && user.role !== 'super_admin' ? (
                <div className="relative">
                  <select
                    value={user.role}
                    onChange={e => handleRoleChange(user.id, e.target.value as 'staff' | 'admin')}
                    disabled={isPending}
                    aria-label={`Role for ${getUserDisplayName(user)}`}
                    className="h-10 pl-3 pr-8 rounded-lg border border-input bg-background text-xs appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 fine:h-8"
                  >
                    {(['staff', 'admin'] as const).map(r => (
                      <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              ) : (
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium',
                  user.role === 'super_admin' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                  : user.role === 'admin'     ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'bg-muted text-muted-foreground'
                )}>
                  {user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Admin' : 'Staff'}
                </span>
              )}
            </div>

            {/* Resend invite */}
            {isSuperAdmin && user.role !== 'super_admin' && (
              <button
                onClick={() => handleResendInvite(user.id, user.email ?? '')}
                disabled={isPending}
                title="Resend invite email"
                aria-label={`Resend invite email to ${getUserDisplayName(user)}`}
                className="h-10 w-10 fine:h-8 fine:w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
              >
                <Mail size={13} />
              </button>
            )}

            {/* Set password */}
            {isSuperAdmin && (
              <button
                onClick={() => { setPwUserId(user.id); setPwValue('') }}
                title="Set password"
                aria-label={`Set password for ${getUserDisplayName(user)}`}
                className="h-10 w-10 fine:h-8 fine:w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
              >
                <KeyRound size={13} />
              </button>
            )}

            {/* Activate / deactivate */}
            {isSuperAdmin && user.role !== 'super_admin' && (
              <button
                onClick={() => handleToggleActive(user.id, user.is_active)}
                disabled={isPending}
                title={user.is_active ? 'Deactivate' : 'Activate'}
                aria-label={`${user.is_active ? 'Deactivate' : 'Activate'} ${getUserDisplayName(user)}`}
                className={cn(
                  'h-10 w-10 fine:h-8 fine:w-8 rounded-lg flex items-center justify-center transition-colors shrink-0',
                  user.is_active
                    ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                    : 'text-muted-foreground hover:text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                )}
              >
                <Power size={13} />
              </button>
            )}

            {isSuperAdmin && user.role !== 'super_admin' && (
              <button
                onClick={() => handleDeleteUser(user.id, getUserDisplayName(user))}
                disabled={isPending}
                title="Delete user"
                aria-label={`Delete ${getUserDisplayName(user)}`}
                className="h-10 w-10 fine:h-8 fine:w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              >
                <Trash2 size={13} />
              </button>
            )}
            </div>
          </div>
        ))}
      </div>

      {/* Set password inline form */}
      {pwUserId && (
        <div className="p-4 bg-card border border-primary/30 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Set password</h3>
            <button onClick={() => setPwUserId(null)} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            For: <span className="font-medium text-foreground">{getUserDisplayName(users.find(u => u.id === pwUserId)!)}</span>
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={pwValue}
              onChange={e => setPwValue(e.target.value)}
              placeholder="Min. 8 characters"
              onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
              className="flex-1 h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={handleSetPassword}
              disabled={pwValue.length < 8 || isPending}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {isPending ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Add user */}
      {adding ? (
        <div className="p-5 bg-card border border-primary/30 rounded-xl space-y-4">
          <h3 className="text-sm font-semibold">Create new account</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Full name *</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Jane Smith"
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Email *</label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="jane@company.com"
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Role</label>
            <div className="flex gap-2">
              {([['staff', User, 'Submit and view assigned tasks'],
                 ['admin', ShieldCheck, 'Manage board and settings']] as const).map(([role, Icon, desc]) => (
                <button key={role} type="button" onClick={() => setNewRole(role)}
                  className={cn('flex-1 flex items-start gap-2 p-3 rounded-lg border text-left transition-all',
                    newRole === role ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/20')}>
                  <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-semibold capitalize">{role}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">After creating, use the 🔑 key icon to set their password.</p>
          <div className="flex gap-2 pt-1">
            <button onClick={handleCreateUser} disabled={!newEmail || !newName || isPending}
              className="flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors">
              {isPending ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Create account
            </button>
            <button onClick={() => setAdding(false)}
              className="h-9 px-4 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-2 h-10 px-4 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
          <UserPlus size={15} />
          Add user
        </button>
      )}
    </div>
  )
}
