import { redirect } from 'next/navigation'
import { validateInvite } from '@/lib/actions/invite'
import InviteForm from './InviteForm'

export const dynamic = 'force-dynamic'
const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

interface Props { params: { token: string } }

export default async function InvitePage({ params }: Props) {
  const invite = await validateInvite(params.token)

  if (!invite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-[360px] text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${APP_BASE_PATH}/Yorki.png`} alt="Yorki" className="h-8 w-auto mx-auto mb-8 opacity-80" />
          <div className="bg-card border border-border/80 rounded-2xl p-8 shadow-xl shadow-black/5">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h1 className="text-lg font-semibold text-foreground mb-2">Link expired</h1>
            <p className="text-sm text-muted-foreground">
              This invite link is invalid or has expired. Ask your admin to send a new one.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-[0.07]"
          style={{ background: 'radial-gradient(circle, #6A97C4, transparent)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-[0.06]"
          style={{ background: 'radial-gradient(circle, #A6784A, transparent)' }} />
      </div>

      <div className="w-full max-w-[380px] relative">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${APP_BASE_PATH}/Yorki.png`} alt="Yorki" className="h-8 w-auto mx-auto mb-7 opacity-95" />
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Set your password</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Welcome to Yorki, {invite.full_name ?? invite.email}</p>
        </div>

        <div className="bg-card border border-border/80 rounded-2xl p-7 shadow-xl shadow-black/5 dark:shadow-black/30">
          {/* User info */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border/50 mb-6">
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold text-sm flex items-center justify-center shrink-0">
              {(invite.full_name ?? invite.email ?? '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{invite.full_name}</p>
              <p className="text-xs text-muted-foreground truncate">{invite.email}</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-primary/10 text-primary">
              {invite.role === 'admin' ? 'Admin' : 'Staff'}
            </span>
          </div>

          <InviteForm token={params.token} />
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40 mt-6">
          Link expires 48 hours after it was sent
        </p>
      </div>
    </div>
  )
}
