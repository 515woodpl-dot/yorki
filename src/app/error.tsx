'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Yorki Error]', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      time: new Date().toISOString(),
    })
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F6F3EE] px-6 text-[#2F3650]">
      <div className="w-full max-w-md rounded-3xl border border-[#D9E2EE] bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-3 text-sm text-[#5C6E91]">
          The app hit an unexpected error. Try again, and if it keeps happening let me know what page you were on.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-[#A6784A] px-5 text-sm font-semibold text-[#F6F3EE]"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
