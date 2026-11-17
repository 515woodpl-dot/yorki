import { getSessionUser } from '@/lib/auth'
import { getAllUsers } from '@/lib/local-data'
import SubmitForm from './SubmitForm'
import Link from 'next/link'
import { ArrowLeft, Sparkles } from 'lucide-react'

export default async function SubmitPage() {
  const user = await getSessionUser()
  const staffUsers = (await getAllUsers()).filter((entry) => entry.is_active && entry.role !== 'super_admin')
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 sm:px-8 sm:py-10">
        <Link href="/dashboard" className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft size={14} /> Back to board</Link>
        <div className="relative mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-[#203a70] via-[#284b85] to-[#3979a8] px-6 py-5 text-white shadow-lg shadow-[#1f3154]/15 sm:px-8 sm:py-6">
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-28 h-64 w-64 rounded-full border-[38px] border-white/[0.05]" />
          <div className="relative flex flex-wrap items-end justify-between gap-3"><div><p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#c7d9ee]"><Sparkles size={14} /> Let&apos;s make progress</p><h1 className="text-3xl font-semibold tracking-tight">New request</h1><p className="mt-2 text-sm text-white/75">Give your team the details to get the job moving.</p></div><p className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white/85">Submitting as&nbsp;<span className="font-semibold text-white">{user?.full_name ?? user?.email}</span></p></div>
        </div>
        <SubmitForm staffUsers={staffUsers} />
      </div>
    </div>
  )
}
