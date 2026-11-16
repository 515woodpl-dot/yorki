/**
 * GET /api/board/stream — Server-Sent Events for the live board.
 *
 * Sends a tiny `change` event whenever the board's change feed advances or
 * the set of people viewing/editing cards changes. The event carries no task
 * data: the browser then calls getBoardSnapshot(), which applies the normal
 * per-user visibility rules. That keeps this stream safe for staff users.
 *
 * Polling SQLite every POLL_MS is intentionally simple: it works across
 * multiple server processes and survives restarts, and MAX(seq) on an
 * indexed table costs microseconds.
 */

import { getSessionUser } from '@/lib/auth'
import { DEFAULT_BOARD_ID, getLatestBoardEventSeq, getTaskPresenceSignature } from '@/lib/local-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const POLL_MS = 1500
const KEEPALIVE_MS = 20_000
// Close and let the browser reconnect periodically, so sessions that expire
// or users that are deactivated stop receiving events.
const MAX_STREAM_MS = 10 * 60 * 1000

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let lastSeq = -1
      let lastPresence = ''

      const cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(pollTimer)
        clearInterval(keepAliveTimer)
        clearTimeout(closeTimer)
        try { controller.close() } catch { /* already closed */ }
      }

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      const poll = () => {
        try {
          const seq = getLatestBoardEventSeq(DEFAULT_BOARD_ID)
          const presence = getTaskPresenceSignature()
          if (seq !== lastSeq || presence !== lastPresence) {
            const kind = seq !== lastSeq ? 'board' : 'presence'
            lastSeq = seq
            lastPresence = presence
            send(`event: change\ndata: ${JSON.stringify({ seq, kind })}\n\n`)
          }
        } catch (err) {
          console.error('[Live] stream poll failed', err)
        }
      }

      // Ask the browser to wait 3s before reconnecting after a drop.
      send('retry: 3000\n\n')
      poll()
      pollTimer = setInterval(poll, POLL_MS)
      keepAliveTimer = setInterval(() => send(': keep-alive\n\n'), KEEPALIVE_MS)
      closeTimer = setTimeout(cleanup, MAX_STREAM_MS)
      request.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      clearInterval(pollTimer)
      clearInterval(keepAliveTimer)
      clearTimeout(closeTimer)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tell nginx not to buffer this response.
      'X-Accel-Buffering': 'no',
    },
  })
}
