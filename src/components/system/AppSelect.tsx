'use client'

import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AppSelectOption { value: string; label: string }

interface Props {
  value: string
  onValueChange: (value: string) => void
  options: AppSelectOption[]
  placeholder?: string
  ariaLabel?: string
  id?: string
  disabled?: boolean
  className?: string
}

const EMPTY = '__yorki_empty_option__'

export default function AppSelect({ value, onValueChange, options, placeholder, ariaLabel, id, disabled, className }: Props) {
  const selected = value === '' ? (options.some(option => option.value === '') ? EMPTY : undefined) : value
  return (
    <Select.Root value={selected} onValueChange={(next) => onValueChange(next === EMPTY ? '' : next)} disabled={disabled}>
      <Select.Trigger id={id} aria-label={ariaLabel} className={cn('inline-flex min-w-0 items-center justify-between gap-2 rounded-xl border border-input bg-card px-3 text-left text-sm text-foreground shadow-sm outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', className)}>
        <Select.Value placeholder={placeholder} />
        <Select.Icon><ChevronDown size={15} className="shrink-0 text-muted-foreground" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={5} className="z-[100] max-h-[min(60vh,24rem)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl animate-in">
          <Select.Viewport className="max-h-[min(60vh,24rem)] overflow-y-auto">
            {options.map((option) => (
              <Select.Item key={option.value} value={option.value || EMPTY} className="relative flex min-h-10 cursor-pointer select-none items-center rounded-lg py-2 pl-3 pr-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:font-medium">
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-2 text-primary"><Check size={15} /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
