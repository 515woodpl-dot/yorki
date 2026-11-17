'use client'

import { useState, useTransition } from 'react'
import { useTheme } from 'next-themes'
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, Clock3, Database, HardDrive, Loader2, Moon, Palette, ShieldCheck, Sun } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { updateTheme } from '@/lib/actions/settings'
import { cn, getAppThemeForNow, type AppThemeMode } from '@/lib/utils'

type BackupHistory = {
  lastBackupOkUtc: string | null
  minutesSinceLast: number | null
  status: 'ok' | 'stale' | 'unknown'
  recentLogLines: string[]
}

const themes = [
  { mode: 'auto', label: 'Automatic', description: 'Changes every 12 hours', icon: Clock3 },
  { mode: 'light', label: 'Light', description: 'A brighter workspace', icon: Sun },
  { mode: 'dark', label: 'Dark', description: 'Easy on the eyes', icon: Moon },
] as const

function backupTime(value: string | null) {
  if (!value) return 'Not recorded yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(date)}`
}

function backupAge(minutes: number | null) {
  if (minutes === null) return 'No backup time available'
  if (minutes < 1) return 'Less than a minute ago'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

export default function SettingsClient({ initialThemeMode, backupHistory }: { initialThemeMode: AppThemeMode; backupHistory: BackupHistory }) {
  const { setTheme } = useTheme()
  const [isPending, start] = useTransition()
  const [selected, setSelected] = useState<AppThemeMode>(initialThemeMode)

  function handleTheme(mode: AppThemeMode) {
    const previous = selected
    setSelected(mode)
    setTheme(mode === 'auto' ? getAppThemeForNow() : mode)
    start(async () => {
      try {
        const result = await updateTheme(mode)
        if (!result.success) throw new Error(result.error)
        toast.success('Appearance updated')
      } catch {
        setSelected(previous)
        setTheme(previous === 'auto' ? getAppThemeForNow() : previous)
        toast.error('Could not save appearance. Please try again.')
      }
    })
  }

  const status = backupHistory.status === 'ok'
    ? { label: 'On schedule', detail: 'A recent successful backup was recorded.', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900' }
    : backupHistory.status === 'stale'
      ? { label: 'Needs attention', detail: 'The last recorded backup is older than expected.', className: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900' }
      : { label: 'Not available', detail: 'No successful backup has been recorded yet.', className: 'bg-muted text-muted-foreground ring-border' }

  return (
    <div className="mx-auto w-full max-w-5xl pb-8">
      <div className="mb-8 sm:mb-10">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/70">Workspace / Settings</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Settings</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">A little control center for your workspace, appearance, and backups.</p>
      </div>

      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
          <div className="flex flex-wrap items-center gap-4 border-b border-border/70 px-5 py-5 sm:px-7">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground">Y</div>
            <div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your workspace</p><h2 className="mt-1 text-lg font-semibold tracking-tight">Yorki <span className="font-normal text-muted-foreground">/</span> Golden Stone Works</h2></div>
            <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">Version 3.0.4</span>
          </div>
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-7">
            <div className="flex items-start gap-3"><div className="rounded-xl bg-primary/5 p-2.5 text-primary"><Database size={17} /></div><div><p className="text-sm font-semibold">Workspace storage</p><p className="mt-1 text-xs leading-5 text-muted-foreground">SQLite database with support for an external data location.</p></div></div>
            <Link href="/admin/users" className="group flex items-start gap-3 rounded-xl transition-colors hover:bg-accent/40"><div className="rounded-xl bg-primary/5 p-2.5 text-primary"><ShieldCheck size={17} /></div><div className="flex-1"><p className="text-sm font-semibold">Team access</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Manage the people who use Yorki.</p></div><ArrowUpRight size={16} className="mt-1 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></Link>
          </div>
        </section>

        <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm sm:p-7">
          <div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary"><Palette size={19} /></div><div><h2 className="text-base font-semibold tracking-tight">Appearance</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Choose how Yorki looks across your workspace.</p></div></div>
          <div role="group" aria-label="Default theme" className="mt-6 grid gap-3 sm:grid-cols-3">
            {themes.map(({ mode, label, description, icon: Icon }) => (
              <button key={mode} type="button" aria-pressed={selected === mode} onClick={() => handleTheme(mode)} disabled={isPending} className={cn('relative flex min-h-[104px] items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-70', selected === mode ? 'border-primary bg-primary/[0.05] ring-1 ring-primary/30' : 'border-border hover:border-primary/40 hover:bg-accent/30')}>
                <span className={cn('rounded-lg p-2', selected === mode ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}><Icon size={17} /></span>
                <span className="min-w-0 pt-0.5"><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span>
                {selected === mode && <span className="absolute right-3 top-3 text-primary">{isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}</span>}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">Automatic switches between light and dark every 12 hours, based on Seattle time.</p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 sm:px-7 sm:pt-7">
            <div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/5 text-primary"><HardDrive size={19} /></div><div><h2 className="text-base font-semibold tracking-tight">Database backups</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Keep an eye on your workspace backup history.</p></div></div>
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset', status.className)}>{backupHistory.status === 'ok' && <CheckCircle2 size={13} />}{status.label}</span>
          </div>
          <div className="mx-5 mt-6 rounded-xl border border-border/70 bg-background/70 p-4 sm:mx-7 sm:p-5">
            <p className="text-xs font-medium text-muted-foreground">Last successful backup</p>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2"><p className="text-base font-semibold tracking-tight">{backupTime(backupHistory.lastBackupOkUtc)}</p><p className="text-xs font-medium text-muted-foreground">{backupAge(backupHistory.minutesSinceLast)}</p></div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{status.detail}</p>
          </div>
          <details className="group mx-5 mb-5 mt-4 sm:mx-7 sm:mb-7">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg px-1 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">View recent backup log <ChevronDown size={16} className="transition-transform group-open:rotate-180" /></summary>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-4 text-xs leading-relaxed text-foreground">{backupHistory.recentLogLines.join('\n') || 'No backup log entries available.'}</pre>
          </details>
        </section>
      </div>
    </div>
  )
}
