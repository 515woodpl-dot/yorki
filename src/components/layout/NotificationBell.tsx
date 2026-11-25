'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AtSign, Bell, CheckCircle2, MessageSquare, UserPlus } from 'lucide-react'
import { getMyNotifications, markMyNotificationsRead } from '@/lib/actions/notifications'
import { useLiveEvents } from '@/lib/live/client'
import { readPushStatus, syncAppBadge, type PushStatus } from '@/lib/push/client'
import { cn, formatRelativeDate } from '@/lib/utils'
import type { AppNotification, NotificationType } from '@/lib/types'

const TYPE_META: Record<NotificationType, { icon: typeof Bell; verb: string; color: string }> = {
  mention:   { icon: AtSign,        verb: 'mentioned you on',  color: 'text-primary' },
  comment:   { icon: MessageSquare, verb: 'commented on',      color: 'text-sky-600 dark:text-sky-400' },
  assigned:  { icon: UserPlus,      verb: 'assigned you to',   color: 'text-violet-600 dark:text-violet-400' },
  completed: { icon: CheckCircle2,  verb: 'completed',         color: 'text-green-600 dark:text-green-400' },
}

function headline(item: AppNotification) {
  const meta = TYPE_META[item.type] ?? TYPE_META.comment
  return `${item.actor_name ?? 'Someone'} ${meta.verb} “${item.task_title ?? 'a card'}”`
}

export default function NotificationBell({ align = 'right', placement = 'below' }: { align?: 'left' | 'right'; placement?: 'above' | 'below' }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [pushStatus, setPushStatus] = useState<PushStatus>('checking')
  const seenIdsRef = useRef<Set<string> | null>(null)
  const loadingRef = useRef(false)

  const load = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      const data = await getMyNotifications()
      // Pop a toast for genuinely new mentions/assignments (not on first load).
      if (seenIdsRef.current) {
        const fresh = data.items.filter((item) => !seenIdsRef.current!.has(item.id) && !item.read_at)
        const important = fresh.filter((item) => item.type === 'mention' || item.type === 'assigned')
        if (important.length > 0) {
          const first = important[0]
          toast(headline(first), {
            description: first.type === 'mention' ? first.snippet ?? undefined : undefined,
            action: first.task_id
              ? { label: 'Open', onClick: () => openItem(first) }
              : undefined,
            duration: 8000,
          })
        }
      }
      seenIdsRef.current = new Set(data.items.map((item) => item.id))
      setItems(data.items)
      setUnread(data.unread)
      syncAppBadge(data.unread) // the little number on the app icon
    } catch {
      // Signed out or offline — the next live event will retry.
    } finally {
      loadingRef.current = false
    }
    // openItem is stable enough for this purpose; avoid re-creating load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void load() }, [load])
  useLiveEvents((info) => {
    if (info.kind === 'notifications' || info.kind === 'resync') void load()
  })

  function openItem(item: AppNotification) {
    setOpen(false)
    if (!item.read_at) {
      setItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry))
      setUnread((count) => Math.max(0, count - 1))
      void markMyNotificationsRead([item.id])
    }
    if (item.task_id && item.task_title) {
      router.push(`/dashboard?task=${encodeURIComponent(item.task_id)}`)
    } else {
      toast.info('That card is no longer available.')
    }
  }

  async function markAllRead() {
    setItems((prev) => prev.map((entry) => entry.read_at ? entry : { ...entry, read_at: new Date().toISOString() }))
    setUnread(0)
    await markMyNotificationsRead()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          const opening = !open
          setOpen(opening)
          if (opening) void readPushStatus().then((result) => setPushStatus(result.status)).catch(() => {})
        }}
        className="relative inline-flex h-11 w-11 lg:h-8 lg:w-8 items-center justify-center rounded-lg sm:rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell size={16} strokeWidth={1.9} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-4 text-center tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={cn(
            'fixed inset-x-3 top-[calc(4.75rem+env(safe-area-inset-top))] z-20 max-h-[calc(100dvh-6rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] bg-card border border-border rounded-xl shadow-xl animate-scale-in overflow-hidden sm:absolute sm:inset-x-auto sm:top-auto sm:w-[min(360px,calc(100vw-24px))] sm:max-h-none',
            align === 'right' ? 'sm:right-0' : 'sm:left-0',
            placement === 'above' ? 'sm:bottom-full sm:mb-1.5' : 'sm:top-full sm:mt-1.5',
          )}>
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
              <p className="text-xs font-semibold text-foreground">Notifications</p>
              {unread > 0 && (
                <button type="button" onClick={markAllRead} className="text-[11px] font-medium text-primary hover:underline">
                  Mark all as read
                </button>
              )}
            </div>
            <div className="max-h-[calc(100dvh-13rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto sm:max-h-[50dvh]">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                  You&apos;re all caught up. Mentions, assignments and replies on your cards show up here.
                </p>
              ) : items.map((item) => {
                const meta = TYPE_META[item.type] ?? TYPE_META.comment
                const Icon = meta.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      'w-full text-left flex gap-2.5 px-3.5 py-2.5 border-b border-border/50 last:border-b-0 hover:bg-accent/50 transition-colors',
                      !item.read_at && 'bg-primary/[0.04]',
                    )}
                  >
                    <Icon size={14} className={cn('mt-0.5 shrink-0', meta.color)} />
                    <span className="flex-1 min-w-0">
                      <span className={cn('block text-xs leading-snug', item.read_at ? 'text-muted-foreground' : 'text-foreground font-medium')}>
                        {headline(item)}
                      </span>
                      {item.snippet && (item.type === 'mention' || item.type === 'comment') && (
                        <span className="block mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{item.snippet}</span>
                      )}
                      <span className="block mt-0.5 text-[10px] text-muted-foreground/70">{formatRelativeDate(item.created_at)}</span>
                    </span>
                    {!item.read_at && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />}
                  </button>
                )
              })}
            </div>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center justify-between gap-2 border-t border-border px-3.5 text-xs font-medium text-primary hover:bg-accent/50"
            >
              <span>
                {pushStatus === 'off' ? 'Get alerts when Yorki is closed'
                  : pushStatus === 'needs-install' ? 'Add to Home Screen for phone alerts'
                  : 'Notification settings'}
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
