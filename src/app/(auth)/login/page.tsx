import LoginForm from './LoginForm'

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const timedOut = reason === 'timeout'

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">

      {/* Subtle background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-[0.07] dark:opacity-[0.05]"
          style={{ background: 'radial-gradient(circle, #6A97C4, transparent)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-[0.07] dark:opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #A6784A, transparent)' }} />
      </div>

      <div className="w-full max-w-[360px] relative">

        {/* Logo */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${APP_BASE_PATH}/Yorki.png`} alt="Yorki" className="h-9 w-auto mx-auto mb-7 opacity-95" />
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Sign in to your workspace</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border/80 rounded-2xl p-7 shadow-xl shadow-black/5 dark:shadow-black/30">
          {timedOut && (
            <p className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300" role="status">
              Your session ended after 10 minutes of inactivity. Please sign in again.
            </p>
          )}
          <LoginForm />
        </div>

        <p className="text-center text-[11px] text-muted-foreground/50 mt-6">
          Yorki · Internal workspace
        </p>
      </div>
    </div>
  )
}
