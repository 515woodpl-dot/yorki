'use client'

import type { MouseEvent } from 'react'

const URL_PATTERN = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+)/gi

function normalizeUrl(rawUrl: string) {
  const trimmed = rawUrl.trim().replace(/[),.;!?]+$/g, '')
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export default function LinkifiedText({
  text,
  className,
  stopPropagation = false,
}: {
  text: string
  className?: string
  stopPropagation?: boolean
}) {
  const lines = text.split('\n')

  function handleLinkClick(event: MouseEvent<HTMLAnchorElement>) {
    if (stopPropagation) event.stopPropagation()
  }

  return (
    <span className={className}>
      {lines.map((line, lineIndex) => {
        const matches = Array.from(line.matchAll(URL_PATTERN))
        let cursor = 0

        return (
          <span key={`${lineIndex}-${line}`}>
            {matches.map((match, matchIndex) => {
              const start = match.index ?? 0
              const end = start + match[0].length
              const before = line.slice(cursor, start)
              const normalizedUrl = normalizeUrl(match[0])
              cursor = end

              return (
                <span key={`${lineIndex}-${matchIndex}-${start}`}>
                  {before}
                  {normalizedUrl ? (
                    <a
                      href={normalizedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleLinkClick}
                      className="underline decoration-primary/60 underline-offset-2 text-primary hover:text-primary/80"
                    >
                      {match[0].replace(/[),.;!?]+$/g, '')}
                    </a>
                  ) : (
                    match[0]
                  )}
                </span>
              )
            })}
            {line.slice(cursor)}
            {lineIndex < lines.length - 1 && <br />}
          </span>
        )
      })}
    </span>
  )
}
