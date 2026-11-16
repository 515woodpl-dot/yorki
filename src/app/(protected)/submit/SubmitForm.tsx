'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Loader2, Paperclip, X, Plus,
  Calendar, Clock, AlignLeft, Type, Flag, MapPin, CheckSquare, Mail,
} from 'lucide-react'
import { createTask } from '@/lib/actions/tasks'
import { cn, getCurrentDateInAppTimeZone } from '@/lib/utils'
import type { Priority, UserProfile } from '@/lib/types'

const schema = z.object({
  title:       z.string().min(1, 'Title is required').max(500, 'Title too long'),
  description: z.string().max(10000).optional(),
  priority:    z.enum(['low', 'normal', 'high', 'urgent']),
  due_date:    z.string().optional(),
  time_slot:   z.string().optional(),
  notes:       z.string().max(5000).optional(),
  address:     z.string().max(1000).optional(),
  send_to_calendar: z.boolean().optional(),
})
type FormValues = z.infer<typeof schema>

interface ChecklistItem { id: string; label: string; checked: boolean }
interface SubmitFormProps { staffUsers: UserProfile[] }

const priorities: { value: Priority; label: string; color: string; dot: string }[] = [
  { value: 'low',    label: 'Low',    color: 'border-gray-300  text-gray-600  data-[sel=true]:bg-gray-100  data-[sel=true]:border-gray-400',  dot: 'bg-gray-400' },
  { value: 'normal', label: 'Normal', color: 'border-blue-300  text-blue-600  data-[sel=true]:bg-blue-50   data-[sel=true]:border-blue-500',  dot: 'bg-blue-500' },
  { value: 'high',   label: 'High',   color: 'border-orange-300 text-orange-600 data-[sel=true]:bg-orange-50 data-[sel=true]:border-orange-500', dot: 'bg-orange-500' },
  { value: 'urgent', label: 'Urgent', color: 'border-red-300   text-red-600   data-[sel=true]:bg-red-50    data-[sel=true]:border-red-500',   dot: 'bg-red-500' },
]

interface UploadedFile { file: File; preview: string | null }

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''
const TIME_SLOTS = [
  { value: '', label: 'No time slot' },
  ...Array.from({ length: 33 }, (_, index) => {
    const totalMinutes = (6 * 60) + (index * 30)
    const hour = Math.floor(totalMinutes / 60)
    const minute = totalMinutes % 60
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    const displayHour = ((hour + 11) % 12) + 1
    const period = hour >= 12 ? 'PM' : 'AM'
    const minuteLabel = minute === 0 ? '' : ':30'
    return { value, label: `${displayHour}${minuteLabel} ${period}` }
  }),
] as const

function combineDueDateAndTime(dateValue?: string, timeSlot?: string) {
  const normalizedDate = dateValue?.trim()
  if (!normalizedDate) return undefined
  const normalizedTime = timeSlot?.trim()
  if (!normalizedTime) return normalizedDate
  return `${normalizedDate}T${normalizedTime}:00`
}

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function SubmitForm({ staffUsers }: SubmitFormProps) {
  const router = useRouter()
  const [files,      setFiles]      = useState<UploadedFile[]>([])
  const [checklist,  setChecklist]  = useState<ChecklistItem[]>([])
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { priority: 'normal', send_to_calendar: false, time_slot: '' },
  })

  const selectedPriority = watch('priority')

  // ─── Checklist helpers ────────────────────────────────────────────────────
  function addChecklistItem() {
    setChecklist(prev => [...prev, { id: createClientId(), label: '', checked: false }])
  }

  function updateChecklistLabel(id: string, label: string) {
    setChecklist(prev => prev.map(item => item.id === id ? { ...item, label } : item))
  }

  function toggleChecklistItem(id: string) {
    setChecklist(prev => prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item))
  }

  function removeChecklistItem(id: string) {
    setChecklist(prev => prev.filter(item => item.id !== id))
  }

  // ─── File helpers ─────────────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files ?? [])
    for (const f of newFiles) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} is too large (max 10MB)`); continue }
      const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : null
      setFiles(prev => [...prev, { file: f, preview }])
    }
    e.target.value = ''
  }

  function removeFile(index: number) {
    setFiles(prev => {
      const updated = [...prev]
      if (updated[index].preview) URL.revokeObjectURL(updated[index].preview!)
      updated.splice(index, 1)
      return updated
    })
  }

  // ─── Submit ───────────────────────────────────────────────────────────────
  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    try {
      const custom_fields: Record<string, unknown> = {}
      if (values.address?.trim())  custom_fields.address  = values.address.trim()
      if (checklist.length > 0)    custom_fields.checklist = checklist.filter(i => i.label.trim())
      if (values.send_to_calendar) custom_fields.send_to_calendar = true

      const dueDateValue = combineDueDateAndTime(values.due_date, values.time_slot)
      const result = await createTask({
        title:       values.title,
        description: [values.description, values.notes].filter(Boolean).join('\n\n---\n\n') || undefined,
        assigned_to: selectedAssigneeIds,
        priority:    values.priority,
        due_date:    dueDateValue,
        custom_fields,
      })

      if (!result.success) { toast.error(result.error); setSubmitting(false); return }

      if (files.length > 0 && result.data?.id) {
        const uploadResults = await Promise.all(files.map(async ({ file }) => {
          const fd = new FormData()
          fd.append('file', file)
          fd.append('task_id', result.data!.id)
          const response = await fetch(`${APP_BASE_PATH}/api/upload`, { method: 'POST', body: fd })
          if (!response.ok) {
            const payload = await response.json().catch(() => ({ error: 'Upload failed' }))
            throw new Error(payload.error || `Failed to upload ${file.name}`)
          }
          return response
        }))
        void uploadResults
      }

      toast.success(selectedAssigneeIds.length > 0 ? 'Request submitted and assigned' : 'Request submitted — check the board!')
      reset()
      setFiles([])
      setChecklist([])
      setSelectedAssigneeIds([])
      router.push('/dashboard')
      router.refresh()
    } catch {
      toast.error('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  const inputClass = cn(
    'w-full px-4 rounded-xl border bg-background/60 text-foreground',
    'placeholder:text-muted-foreground text-sm',
    'focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors',
    'border-input'
  )

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">

      <section className="space-y-6 rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-8">
      <div className="flex items-start gap-4 border-b border-border/70 pb-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-sm font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">01</span><div><h2 className="text-lg font-semibold tracking-tight">The essentials</h2><p className="mt-1 text-sm text-muted-foreground">Start with the big picture. You can add the details below.</p></div></div>

      {/* Title */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Type size={14} className="text-muted-foreground" />
          Title <span className="text-destructive">*</span>
        </label>
        <input
          {...register('title')}
          placeholder="What needs to be done?"
          className={cn(inputClass, 'h-11', errors.title && 'border-destructive')}
        />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AlignLeft size={14} className="text-muted-foreground" />
          Description
        </label>
        <textarea
          {...register('description')}
          placeholder="Provide any relevant details, context, or instructions…"
          rows={4}
          className={cn(inputClass, 'py-2.5 resize-none')}
        />
      </div>

      </section>
      <section className="space-y-6 rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-8">
      <div className="flex items-start gap-4 border-b border-border/70 pb-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-sm font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">02</span><div><h2 className="text-lg font-semibold tracking-tight">People &amp; place</h2><p className="mt-1 text-sm text-muted-foreground">Bring the right people in and add the job location.</p></div></div>
      {/* Assign to */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Mail size={14} className="text-muted-foreground" />
          Assign to
          <span className="text-xs text-muted-foreground font-normal">(optional)</span>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {staffUsers.map((staffUser) => {
            const checked = selectedAssigneeIds.includes(staffUser.id)
            return (
              <label key={staffUser.id} className={cn('flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm transition-colors', checked ? 'border-primary/60 bg-primary/5 text-foreground' : 'border-border bg-background/50 text-foreground hover:border-primary/30')}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    setSelectedAssigneeIds((prev) => (
                      e.target.checked
                        ? [...prev, staffUser.id]
                        : prev.filter((id) => id !== staffUser.id)
                    ))
                  }}
                  className="h-5 w-5 shrink-0 cursor-pointer rounded border-input text-primary accent-[hsl(var(--primary))] focus:ring-primary touch-manipulation"
                />
                <span>{staffUser.full_name ?? staffUser.display_name ?? 'Unnamed user'}</span>
              </label>
            )
          })}
          {staffUsers.length === 0 && (
            <p className="text-xs text-muted-foreground">No assignable users found.</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Pick one or more active users. Assigned users will all see the task, and users with an email can receive the task link.
        </p>
      </div>

      {/* Address */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <MapPin size={14} className="text-muted-foreground" />
          Address
          <span className="text-xs text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          {...register('address')}
          placeholder={"Street address\nCity, State, ZIP\nCountry"}
          rows={3}
          className={cn(inputClass, 'py-2.5 resize-none')}
        />
      </div>

      </section>
      <section className="space-y-6 rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-8">
      <div className="flex items-start gap-4 border-b border-border/70 pb-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-sm font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">03</span><div><h2 className="text-lg font-semibold tracking-tight">Plan the work</h2><p className="mt-1 text-sm text-muted-foreground">Set the priority, timing, and steps for this request.</p></div></div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Calendar size={14} className="text-muted-foreground" />
          Google Calendar
          <span className="text-xs text-muted-foreground font-normal">(optional)</span>
        </label>
        <label className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 text-sm text-foreground">
          <input
            type="checkbox"
            {...register('send_to_calendar')}
            className="h-5 w-5 shrink-0 cursor-pointer rounded border-input text-primary accent-[hsl(var(--primary))] focus:ring-primary touch-manipulation"
          />
          <span>Send this task to Google Calendar</span>
        </label>
        <p className="text-xs text-muted-foreground">
          Only checked tasks will be sent to the calendar.
        </p>
      </div>

      {/* Checklist */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <CheckSquare size={14} className="text-muted-foreground" />
          Checklist
          <span className="text-xs text-muted-foreground font-normal">(optional)</span>
        </label>

        {checklist.length > 0 && (
          <div className="space-y-2">
            {checklist.map(item => (
              <div key={item.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleChecklistItem(item.id)}
                  className={cn(
                    'w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors',
                    item.checked
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-input hover:border-primary/50'
                  )}
                >
                  {item.checked && <span className="text-[10px] font-bold">✓</span>}
                </button>
                <input
                  type="text"
                  value={item.label}
                  onChange={e => updateChecklistLabel(item.id, e.target.value)}
                  placeholder="Checklist item…"
                  className={cn(inputClass, 'h-9 flex-1')}
                />
                <button
                  type="button"
                  onClick={() => removeChecklistItem(item.id)}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addChecklistItem}
          className={cn(
            'flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-border',
            'text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-accent/30',
            'transition-colors'
          )}
        >
          <Plus size={13} />
          Add item
        </button>
      </div>

      {/* Priority */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Flag size={14} className="text-muted-foreground" />
          Priority
        </label>
        <div className="grid grid-cols-4 gap-2">
          {priorities.map(({ value, label, color, dot }) => (
            <button
              key={value}
              type="button"
              data-sel={selectedPriority === value}
              aria-label={label}
              aria-pressed={selectedPriority === value}
              onClick={() => setValue('priority', value)}
              className={cn(
                'h-12 rounded-xl border text-sm font-medium flex items-center justify-center gap-1.5 transition-all',
                color,
                selectedPriority === value && 'ring-2 ring-offset-1 ring-offset-background'
              )}
            >
              <span className={cn('w-2 h-2 rounded-full shrink-0', dot)} />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Due date */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Calendar size={14} className="text-muted-foreground" />
          Due date
          <span className="text-xs text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          {...register('due_date')}
          type="date"
          min={getCurrentDateInAppTimeZone()}
          className={cn(inputClass, 'h-11', '[color-scheme:light] dark:[color-scheme:dark]')}
        />
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Clock size={14} className="text-muted-foreground" />
          Time slot
          <span className="text-xs text-muted-foreground font-normal">(optional)</span>
        </label>
        <select
          {...register('time_slot')}
          className={cn(inputClass, 'h-11')}
          defaultValue=""
        >
          {TIME_SLOTS.map((slot) => (
            <option key={slot.value || 'none'} value={slot.value}>
              {slot.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Choose a time only when the task should land on the calendar at a specific hour.
        </p>
      </div>

      </section>
      <section className="space-y-6 rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-8">
      <div className="flex items-start gap-4 border-b border-border/70 pb-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-sm font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">04</span><div><h2 className="text-lg font-semibold tracking-tight">The finishing details</h2><p className="mt-1 text-sm text-muted-foreground">Add any notes or files your team might need.</p></div></div>
      {/* Notes */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Additional notes</label>
        <textarea
          {...register('notes')}
          placeholder="Any extra information, links, or references…"
          rows={3}
          className={cn(inputClass, 'py-2.5 resize-none')}
        />
      </div>

      {/* Attachments */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Attachments <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        {files.length > 0 && (
          <ul className="space-y-2">
            {files.map(({ file, preview }, i) => (
              <li key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-accent/50 border border-border">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="w-10 h-10 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                    <Paperclip size={14} className="text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button type="button" onClick={() => removeFile(i)}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input ref={fileInputRef} type="file" multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          onChange={handleFileChange} className="hidden" />
        <button type="button" onClick={() => fileInputRef.current?.click()}
          className={cn(
            'w-full h-11 rounded-lg border border-dashed border-border',
            'flex items-center justify-center gap-2',
            'text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-accent/30',
            'transition-colors'
          )}>
          <Paperclip size={15} />
          {files.length === 0 ? 'Add files' : 'Add more files'}
        </button>
      </div>

      </section>
      {/* Submit */}
      <div className="flex justify-end pb-2">
        <button type="submit" disabled={submitting}
          className={cn(
            'w-full sm:w-auto sm:min-w-56 h-12 rounded-xl font-semibold text-sm',
            'bg-primary text-primary-foreground',
            'hover:bg-primary/90 active:scale-[0.99]',
            'disabled:opacity-60 disabled:cursor-not-allowed',
            'transition-all flex items-center justify-center gap-2 shadow-sm'
          )}>
          {submitting ? <><Loader2 size={16} className="animate-spin" />Submitting…</> : 'Submit Request'}
        </button>
      </div>
    </form>
  )
}
