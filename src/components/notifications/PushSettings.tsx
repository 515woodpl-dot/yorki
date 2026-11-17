'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BellOff, BellRing, CheckCircle2, Info, Loader2, Share, Smartphone, Trash2 } from 'lucide-react'
import {
  disablePush, enablePush, endpointId, fetchPushState, readPushStatus, removeDevice, savePushPrefs, sendTestPush,
  type PushPrefsState, type PushServerState, type PushStatus,
} from '@/lib/push/client'
import { cn, formatDate, formatRelativeDate } from '@/lib/utils'

const PREF_ROWS: Array<{ key: keyof PushPrefsState; label: string; hint: string }> = [
  { key: 'mention', label: 'Someone @mentions me', hint: 'In a comment on any card.' },
  { key: 'assigned', label: 'A task is assigned to me', hint: 'Including cards created for you.' },
  { key: 'comment', label: 'Someone comments on a card I’m on', hint: 'Cards I submitted or am assigned to.' },
  { key: 'completed', label: 'A card I’m on is completed', hint: 'So requesters know it’s done.' },
]

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="-my-1.5 -mr-2 flex h-11 w-14 shrink-0 cursor-pointer items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={cn('relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors', checked ? 'bg-primary' : 'bg-muted')}>
        <span className={cn('pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200', checked ? 'translate-x-5' : 'translate-x-0')} />
      </span>
    </button>
  )
}

const card = 'rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6'

export default function PushSettings() {
  const [server, setServer] = useState<PushServerState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<PushStatus>('checking')
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'enable' | 'disable' | 'test'>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setServer(await fetchPushState())
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load notification settings.')
    }
    const current = await readPushStatus()
    setStatus(current.status)
    setThisDeviceId(current.endpoint ? await endpointId(current.endpoint) : null)
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function turnOn() {
    if (!server) return
    setBusy('enable'); setMessage(null)
    try {
      await enablePush(server.publicKey)
      setMessage({ tone: 'ok', text: 'Alerts are on for this device.' })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not turn on alerts.' })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  async function turnOff() {
    setBusy('disable'); setMessage(null)
    try {
      await disablePush()
      setMessage({ tone: 'ok', text: 'Alerts are off for this device.' })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  async function test() {
    setBusy('test'); setMessage(null)
    try {
      const result = await sendTestPush()
      setMessage({ tone: result.ok ? 'ok' : 'error', text: result.message })
    } catch {
      setMessage({ tone: 'error', text: 'Could not send the test.' })
    } finally {
      setBusy(null)
    }
  }

  async function setPref(key: keyof PushPrefsState, value: boolean) {
    if (!server) return
    const previous = server.prefs
    setServer({ ...server, prefs: { ...previous, [key]: value } }) // instant feedback
    try {
      const saved = await savePushPrefs({ [key]: value })
      setServer((current) => (current ? { ...current, prefs: saved } : current))
    } catch {
      setServer((current) => (current ? { ...current, prefs: previous } : current))
      setMessage({ tone: 'error', text: 'Could not save that. Please try again.' })
    }
  }

  async function remove(id: string) {
    try {
      await removeDevice(id)
      if (id === thisDeviceId) await disablePush()
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not remove that device.' })
    }
    await refresh()
  }

  const prefs = server?.prefs
  const anyOn = prefs ? PREF_ROWS.some((row) => prefs[row.key]) : true

  return (
    <div className="space-y-5">
      {/* ── This device ─────────────────────────────────────────────── */}
      <section className={card} aria-labelledby="this-device">
        <div className="flex items-start gap-4">
          <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', status === 'on' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300')}>
            {status === 'on' ? <BellRing size={20} aria-hidden="true" /> : status === 'denied' ? <BellOff size={20} aria-hidden="true" /> : <Smartphone size={20} aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="this-device" className="text-base font-semibold text-foreground">Alerts on this device</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Get a notification when Yorki is closed — even with your screen locked — for the things you choose below.
            </p>

            <div className="mt-4 space-y-3" aria-live="polite">
              {status === 'checking' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" />Checking this device…</p>}

              {status === 'dev' && <Note icon={Info}>Push alerts work in the installed, live app. They’re switched off while the app is being developed.</Note>}

              {status === 'unsupported' && <Note icon={Info}>This browser can’t receive push notifications. Chrome, Edge, Firefox, or Safari on an iPhone (with Yorki added to the Home Screen) can.</Note>}

              {status === 'needs-install' && (
                <Note icon={Share}>
                  <b>On iPhone and iPad, alerts work once Yorki is on your Home Screen.</b>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Tap <b>Share</b> in Safari’s toolbar, then <b>Add to Home Screen</b>.</li>
                    <li>Open Yorki from the new icon.</li>
                    <li>Come back to this page and turn alerts on.</li>
                  </ol>
                  <p className="mt-2 text-xs">Es: añade Yorki a la pantalla de inicio, ábrelo desde ahí y vuelve aquí.</p>
                </Note>
              )}

              {status === 'denied' && (
                <Note icon={BellOff} tone="warn">
                  Notifications are <b>blocked</b> for Yorki on this device. To allow them, open your browser’s site settings (the lock icon next to the address) and set <b>Notifications</b> to <b>Allow</b> — on iPhone, Settings → Notifications → Yorki — then reload this page.
                </Note>
              )}

              {status === 'off' && (
                <button type="button" onClick={turnOn} disabled={busy !== null || !server} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
                  {busy === 'enable' ? <Loader2 size={16} className="animate-spin" /> : <BellRing size={16} aria-hidden="true" />}
                  Turn on alerts on this device
                </button>
              )}

              {status === 'on' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50 px-3.5 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><CheckCircle2 size={16} aria-hidden="true" />On for this device</span>
                  <button type="button" onClick={test} disabled={busy !== null} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-accent disabled:opacity-60">
                    {busy === 'test' && <Loader2 size={15} className="animate-spin" />}Send me a test
                  </button>
                  <button type="button" onClick={turnOff} disabled={busy !== null} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60">
                    {busy === 'disable' ? 'Turning off…' : 'Turn off'}
                  </button>
                </div>
              )}

              {message && (
                <p role="status" className={cn('flex items-start gap-2 text-sm', message.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive')}>
                  {message.tone === 'error' && <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}{message.text}
                </p>
              )}
              {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
            </div>
          </div>
        </div>
      </section>

      {/* ── What to alert about ─────────────────────────────────────── */}
      <section className={card} aria-labelledby="what-to-alert">
        <h2 id="what-to-alert" className="text-base font-semibold text-foreground">What should alert you</h2>
        <p className="mt-1 text-sm text-muted-foreground">Applies to every device you’ve turned alerts on for. The bell inside Yorki always shows everything.</p>
        <div className="mt-3 divide-y divide-border/70">
          {PREF_ROWS.map((row) => (
            <div key={row.key} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.hint}</p>
              </div>
              <Switch checked={prefs?.[row.key] ?? true} onChange={(value) => setPref(row.key, value)} label={row.label} disabled={!prefs} />
            </div>
          ))}
          <div className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Show names and task titles on the lock screen</p>
              <p className="text-xs text-muted-foreground">Turn off for privacy: alerts then only say “You have a new notification”.</p>
            </div>
            <Switch checked={prefs?.show_preview ?? true} onChange={(value) => setPref('show_preview', value)} label="Show names and task titles on the lock screen" disabled={!prefs} />
          </div>
        </div>
        {prefs && !anyOn && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Everything is off, so no alerts will be sent.</p>}
      </section>

      {/* ── Devices ─────────────────────────────────────────────────── */}
      <section className={card} aria-labelledby="your-devices">
        <h2 id="your-devices" className="text-base font-semibold text-foreground">Your devices</h2>
        {!server ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        ) : server.devices.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No device has alerts turned on yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border/70">
            {server.devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 py-3">
                <Smartphone size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {device.label}
                    {device.id === thisDeviceId && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">This device</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Added {formatDate(device.created_at)}
                    {device.last_success_at ? ` · last alert ${formatRelativeDate(device.last_success_at)}` : ' · no alerts yet'}
                    {device.failures > 0 && ' · having trouble receiving'}
                  </p>
                </div>
                <button type="button" onClick={() => remove(device.id)} aria-label={`Remove ${device.label}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Signing out of Yorki turns alerts off on that device, so the next person to use it doesn’t see yours.</p>
      </section>
    </div>
  )
}

function Note({ icon: Icon, tone = 'info', children }: { icon: typeof Info; tone?: 'info' | 'warn'; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-3.5 text-sm', tone === 'warn' ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100' : 'border-border bg-background text-foreground')}>
      <Icon size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
