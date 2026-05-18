'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

export default function ToastAutoDismiss() {
  useEffect(() => {
    const dismissAll = () => {
      toast.dismiss()
    }

    window.addEventListener('pointerdown', dismissAll, { passive: true })
    window.addEventListener('keydown', dismissAll)

    return () => {
      window.removeEventListener('pointerdown', dismissAll)
      window.removeEventListener('keydown', dismissAll)
    }
  }, [])

  return null
}

