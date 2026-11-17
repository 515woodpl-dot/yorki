'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react'
import { cn } from '@/lib/utils'
import { signIn } from './actions'

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

export default function LoginForm() {
  const router = useRouter()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setLoading(true)

    try {
      const result = await signIn(email.trim().toLowerCase(), password)

      if (!result.success) {
        setError(result.error)
        setLoading(false)
        return
      }

      // Make sure this browser actually kept the sign-in. Otherwise say so instead of doing nothing.
      const check = await fetch(`${APP_BASE_PATH}/api/session/refresh`, { method: 'POST', credentials: 'same-origin' }).catch(() => null)
      if (!check || !check.ok) {
        setError('Signed in, but this browser did not keep the session. Open Yorki using its https:// address and try again.')
        setLoading(false)
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">Email address</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@company.com"
          className={cn(
            'w-full h-10 px-3 rounded-lg border bg-background text-foreground text-sm',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors',
            error ? 'border-destructive' : 'border-input'
          )}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
        <div className="relative">
          <input
            id="password"
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            className={cn(
              'w-full h-11 px-3 pr-11 rounded-lg border bg-background text-foreground text-sm fine:h-10',
              'placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors',
              error ? 'border-destructive' : 'border-input'
            )}
          />
          <button
            type="button"
            onClick={() => setShowPass(v => !v)}
            aria-label={showPass ? 'Hide password' : 'Show password'}
            aria-pressed={showPass}
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors fine:h-10"
          >
            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-lg bg-destructive/10 text-destructive" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className={cn(
          'w-full h-11 rounded-lg font-medium text-sm',
          'bg-primary text-primary-foreground',
          'hover:bg-primary/90 active:scale-[0.98]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-all flex items-center justify-center gap-2'
        )}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
