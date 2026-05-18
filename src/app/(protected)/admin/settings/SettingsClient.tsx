'use client'

import { useState, useTransition } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Loader2, Clock3 } from 'lucide-react'
import { toast } from 'sonner'
import { updateTheme } from '@/lib/actions/settings'
import { cn, getAppThemeForNow, type AppThemeMode } from '@/lib/utils'

type BackupHistory = {
  lastBackupOkUtc: string | null
  minutesSinceLast: number | null
  status: 'ok' | 'stale' | 'unknown'
  recentLogLines: string[]
}

export default function SettingsClient({
  initialThemeMode,
  backupHistory,
}: {
  initialThemeMode: AppThemeMode
  backupHistory: BackupHistory
}) {
  const { setTheme } = useTheme()
  const [isPending, start] = useTransition()
  const [selected, setSelected] = useState<AppThemeMode>(initialThemeMode)

  async function handleTheme(mode: AppThemeMode) {
    setSelected(mode)
    setTheme(mode === 'auto' ? getAppThemeForNow() : mode)
    start(async () => {
      const result = await updateTheme(mode)
      if (result.success) {
        toast.success(mode === 'auto' ? 'Theme cycle set to 12-hour auto' : `Theme set to ${mode}`)
      } else {
        toast.error('Failed to save theme')
      }
    })
  }

  const backupStatusClass = backupHistory.status === 'ok'
    ? 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300'
    : backupHistory.status === 'stale'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
      : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'

  const backupStatusLabel = backupHistory.status === 'ok'
    ? 'Healthy'
    : backupHistory.status === 'stale'
      ? 'Stale'
      : 'Unknown'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your Yorki workspace preferences
        </p>
      </div>

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Workspace</h2>
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          <span className="text-muted-foreground">App name</span>
          <span className="font-medium text-foreground">Yorki</span>
          <span className="text-muted-foreground">Version</span>
          <span className="font-medium text-foreground">3.0.4</span>
          <span className="text-muted-foreground">Data storage</span>
          <span className="font-medium text-foreground">SQLite (external path supported)</span>
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Default theme</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto switches every 12 hours in Seattle time, or choose a fixed mode
          </p>
        </div>
        <div className="flex gap-3">
          {(['auto', 'light', 'dark'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => handleTheme(mode)}
              disabled={isPending}
              className={cn(
                'flex items-center gap-2 px-4 h-9 rounded-lg border text-sm font-medium transition-all',
                selected === mode
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              )}
            >
              {mode === 'auto' ? <Clock3 size={14} /> : mode === 'light' ? <Sun size={14} /> : <Moon size={14} />}
              {mode === 'auto' ? 'Auto 12h' : mode === 'light' ? 'Light' : 'Dark'}
              {isPending && selected === mode && <Loader2 size={12} className="animate-spin" />}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">DB Backup History</h2>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', backupStatusClass)}>
            {backupStatusLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          <span className="text-muted-foreground">Last successful backup (UTC)</span>
          <span className="font-medium text-foreground">
            {backupHistory.lastBackupOkUtc ?? 'Not recorded yet'}
          </span>
          <span className="text-muted-foreground">Minutes since last backup</span>
          <span className="font-medium text-foreground">
            {backupHistory.minutesSinceLast ?? '—'}
          </span>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-2">Recent backup log</p>
          <pre className="max-h-56 overflow-y-auto rounded-lg border border-border bg-background p-3 text-xs leading-relaxed text-foreground">
            {backupHistory.recentLogLines.join('\n')}
          </pre>
        </div>
      </section>
    </div>
  )
}
