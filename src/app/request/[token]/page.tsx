import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Calendar, CheckCircle2, CheckSquare, Clock, MapPin } from 'lucide-react'
import { getSharedTaskData } from '@/lib/actions/tasks'
import { cn, formatDateTime, getPriorityConfig, normalizeAppAssetUrl } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Task Update',
  robots: { index: false, follow: false },
}

interface Props {
  params: Promise<{ token: string }>
}

export default async function SharedTaskPage({ params }: Props) {
  const { token } = await params
  const data = await getSharedTaskData(token)
  if (!data) notFound()

  const { task } = data
  const priority = getPriorityConfig(task.priority)
  const checklist = Array.isArray(task.custom_fields?.checklist)
    ? (task.custom_fields.checklist as Array<{ label: string; checked: boolean }>).filter((item) => item.label)
    : []
  const address = typeof task.custom_fields?.address === 'string' ? task.custom_fields.address : null

  return (
    <main className="min-h-dvh bg-[#F0F2F7] px-4 py-8 text-[#2F3650]">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-[28px] border border-[#D9E2EE] bg-white shadow-[0_20px_60px_rgba(47,54,80,0.12)]">
        <div className="bg-gradient-to-br from-[#2F3650] to-[#425680] px-6 py-8 text-[#F6F3EE]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#B6C5DD]">Yorki Task</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{task.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]', priority.bgClass)}>
              {priority.label}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium capitalize">
              {task.status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        <div className="space-y-6 px-6 py-7">
          <section className="grid gap-3 rounded-2xl border border-[#E3E8F0] bg-[#FBFCFE] p-4 text-sm text-[#4E5F8C] sm:grid-cols-2">
            <InfoRow icon={Clock} label="Created" value={formatDateTime(task.created_at)} />
            <InfoRow icon={Calendar} label="Due" value={task.due_date ? formatDateTime(task.due_date) : 'Not set'} />
            {address && <InfoRow icon={MapPin} label="Address" value={address} fullWidth />}
          </section>

          {task.description && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#7A879F]">Description</h2>
              <p className="whitespace-pre-wrap text-sm leading-7 text-[#33415C]">{task.description}</p>
            </section>
          )}

          {checklist.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#7A879F]">
                <CheckSquare size={13} />
                Checklist
              </h2>
              <div className="space-y-2">
                {checklist.map((item, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-2xl border border-[#E3E8F0] px-4 py-3 text-sm">
                    <div className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                      item.checked ? 'border-[#6A97C4] bg-[#6A97C4] text-white' : 'border-[#C9D4E3] bg-white text-transparent',
                    )}>
                      <CheckCircle2 size={12} />
                    </div>
                    <span className={cn(item.checked ? 'text-[#7A879F] line-through' : 'text-[#33415C]')}>{item.label}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {task.attachments.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#7A879F]">Attachments</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {task.attachments.map((attachment) => (
                  <Link
                    key={attachment.id}
                    href={`${normalizeAppAssetUrl(attachment.public_url)}?token=${encodeURIComponent(token)}`}
                    target="_blank"
                    className="rounded-2xl border border-[#E3E8F0] bg-[#FBFCFE] px-4 py-3 text-sm font-medium text-[#425680] hover:border-[#AFC0D8]"
                  >
                    {attachment.file_name}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  fullWidth = false,
}: {
  icon: typeof Clock
  label: string
  value: string
  fullWidth?: boolean
}) {
  return (
    <div className={cn('flex items-start gap-3', fullWidth && 'sm:col-span-2')}>
      <div className="mt-0.5 rounded-full bg-[#E8EEF7] p-2 text-[#425680]">
        <Icon size={14} />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A96AC]">{label}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#33415C]">{value}</p>
      </div>
    </div>
  )
}
