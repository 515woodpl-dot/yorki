'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { updateEmailSettings } from '@/lib/actions/settings'
import { cn } from '@/lib/utils'
import type { EmailSettings } from '@/lib/types'

interface Props { settings: EmailSettings | null }

const events = [
  { key: 'notify_on_submit',   label: 'New task submitted',  desc: 'Email when a staff member submits a request' },
  { key: 'notify_on_complete', label: 'Task completed',       desc: 'Email when a task is marked as completed' },
  { key: 'notify_on_comment',  label: 'Comment added',        desc: 'Email when a comment is posted on a task' },
  { key: 'notify_on_mention',  label: '@mentions',            desc: 'Email a person when someone @mentions them in a comment' },
] as const

export default function EmailSettingsForm({ settings }: Props) {
  const [isPending, start] = useTransition()

  const [notificationTo, setNotificationTo] = useState(settings?.notification_to ?? '')
  const [replyTo,        setReplyTo]        = useState(settings?.reply_to         ?? '')
  const [subjectPrefix,  setSubjectPrefix]  = useState(settings?.subject_prefix   ?? '[Yorki]')
  const [toggles, setToggles] = useState({
    notify_on_submit:   settings?.notify_on_submit   ?? true,
    notify_on_complete: settings?.notify_on_complete ?? true,
    notify_on_comment:  settings?.notify_on_comment  ?? false,
    notify_on_mention:  settings?.notify_on_mention  ?? true,
  })

  function toggle(key: keyof typeof toggles) {
    setToggles(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleSave() {
    if (!notificationTo.trim()) {
      toast.error('Notification email is required')
      return
    }
    start(async () => {
      const result = await updateEmailSettings({
        notification_to: notificationTo.trim(),
        reply_to:        replyTo.trim() || null,
        subject_prefix:  subjectPrefix.trim() || '[Yorki]',
        ...toggles,
      })
      if (result.success) {
        toast.success('Email settings saved')
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-8 max-w-lg">

      {/* Recipient */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">
          Recipients
        </h2>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Notification email <span className="text-destructive">*</span></label>
          <p className="text-xs text-muted-foreground">Where task notifications are sent (admin inbox)</p>
          <input
            type="email"
            value={notificationTo}
            onChange={e => setNotificationTo(e.target.value)}
            placeholder="admin@yourcompany.com"
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Reply-to address</label>
          <p className="text-xs text-muted-foreground">Optional — staff can reply to notifications</p>
          <input
            type="email"
            value={replyTo}
            onChange={e => setReplyTo(e.target.value)}
            placeholder="helpdesk@yourcompany.com"
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Subject prefix</label>
          <input
            value={subjectPrefix}
            onChange={e => setSubjectPrefix(e.target.value)}
            placeholder="[Yorki]"
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </section>

      {/* Notification triggers */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">
          Notification triggers
        </h2>
        <div className="space-y-3">
          {events.map(({ key, label, desc }) => (
            <div key={key} className="flex items-start gap-4 p-4 bg-card border border-border rounded-xl">
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={toggles[key]}
                onClick={() => toggle(key)}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent',
                  'transition-colors cursor-pointer mt-0.5',
                  toggles[key] ? 'bg-primary' : 'bg-muted'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm',
                    'transition-transform duration-200',
                    toggles[key] ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Note about SMTP config */}
      <div className="p-4 rounded-xl bg-muted/50 border border-border">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Email provider:</strong> Configured via environment variables on the server
          (<code className="font-mono bg-background px-1 py-0.5 rounded">RESEND_API_KEY</code>,{' '}
          <code className="font-mono bg-background px-1 py-0.5 rounded">EMAIL_FROM</code>).
          Contact your system administrator to change the sending provider.
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={isPending}
        className="flex items-center gap-2 h-10 px-6 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
      >
        {isPending && <Loader2 size={14} className="animate-spin" />}
        {isPending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}
