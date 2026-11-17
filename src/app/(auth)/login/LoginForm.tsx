import { BASE_PATH } from '@/lib/form-post'

/** A plain HTML form: it signs in even if JavaScript is blocked, slow, or broken. */
export default function LoginForm({ error, email }: { error?: string; email?: string }) {
  const field = 'w-full h-11 px-3 rounded-lg border bg-background text-foreground text-base sm:text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary'
  const border = error ? 'border-destructive' : 'border-input'
  return (
    <form method="post" action={`${BASE_PATH}/login/submit`} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={email} placeholder="you@company.com" className={`${field} ${border}`} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" className={`${field} ${border}`} />
      </div>
      {error && <p className="text-sm px-3 py-2 rounded-lg bg-destructive/10 text-destructive" role="alert">{error}</p>}
      <button type="submit" className="w-full h-11 rounded-lg font-medium text-sm bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all">
        Sign in
      </button>
    </form>
  )
}
