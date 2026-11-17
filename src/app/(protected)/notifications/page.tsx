import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import PushSettings from '@/components/notifications/PushSettings'

export default function NotificationSettingsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 sm:px-8 sm:py-10">
        <Link href="/dashboard" className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={14} /> Back to board
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Notifications</h1>
        <p className="mb-6 mt-1.5 text-sm text-muted-foreground">Choose how Yorki gets your attention — on your phone, even when the app is closed.</p>
        <PushSettings />
      </div>
    </div>
  )
}
