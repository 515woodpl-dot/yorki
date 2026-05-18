'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { acceptInvite } from '@/lib/actions/invite'

export default function InviteForm({ token }: { token: string }) {
  const router = useRouter()

  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [showPass,  setShowPass]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [done,      setDone]      = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const result = await acceptInvite(token, password)

      if (!result.success) {
        setError(result.error)
        setLoading(false)
        return
      }

      setDone(true)
      setTimeout(() => router.push('/login'), 2000)
    } catch {
      setError('Activation failed. Please try again.')
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center py-4 space-y-3">
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-950/40 flex items-center justify-center mx-auto">
          <CheckCircle2 size={24} className="text-green-600 dark:text-green-400" />
        </div>
        <p className="text-sm font-semibold text-foreground">Password set!</p>
        <p className="text-xs text-muted-foreground">Redirecting to login…</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground uppercase tracking-wider">New password</label>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className={cn(
              'w-full h-10 px-3 pr-10 rounded-lg border bg-background text-foreground text-sm',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors',
              error ? 'border-destructive' : 'border-input'
            )}
          />
          <button type="button" onClick={() => setShowPass(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-foreground uppercase tracking-wider">Confirm password</label>
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="Repeat password"
          className={cn(
            'w-full h-10 px-3 rounded-lg border bg-background text-foreground text-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors',
            error ? 'border-destructive' : 'border-input'
          )}
        />
      </div>

      {/* Password strength hint */}
      {password.length > 0 && (
        <div className="flex gap-1">
          {[1,2,3,4].map(i => (
            <div key={i} className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              password.length >= i * 3
                ? i <= 1 ? 'bg-red-400'
                  : i <= 2 ? 'bg-amber-400'
                  : i <= 3 ? 'bg-blue-400'
                  : 'bg-green-500'
                : 'bg-border'
            )} />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs px-3 py-2 rounded-lg bg-destructive/10 text-destructive" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !password || !confirm}
        className={cn(
          'w-full h-11 rounded-xl font-semibold text-sm mt-2',
          'bg-primary text-primary-foreground',
          'hover:bg-primary/90 active:scale-[0.99]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-all flex items-center justify-center gap-2'
        )}
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : null}
        {loading ? 'Setting password…' : 'Activate account'}
      </button>
    </form>
  )
}
