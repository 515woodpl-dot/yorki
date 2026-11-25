import { canSeeTask } from '@/lib/category-access'
/**
 * POST /api/board/presence — "I have this card open" heartbeat.
 *
 * Body: { clientId: string, taskId: string | null, mode?: 'viewing' | 'editing' }
 * taskId null clears this tab's presence. Uses a plain route (not a server
 * action) so the browser can send it with navigator.sendBeacon on tab close.
 */

import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { clearTaskPresence, getTaskById, upsertTaskPresence } from '@/lib/local-data'
import { isTaskAssignedToUser } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { clientId?: unknown; taskId?: unknown; mode?: unknown }
  try {
    body = JSON.parse(await request.text())
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const clientId = typeof body.clientId === 'string' ? body.clientId.slice(0, 64) : ''
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  if (body.taskId === null || body.taskId === undefined) {
    clearTaskPresence(clientId, user.id)
    return NextResponse.json({ ok: true })
  }

  if (typeof body.taskId !== 'string') {
    return NextResponse.json({ error: 'Invalid taskId' }, { status: 400 })
  }

  const task = await getTaskById(body.taskId)
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  if (!task || !(await canSeeTask(user, task)) || !(isAdmin || task.submitted_by === user.id || isTaskAssignedToUser(task, user.id))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const mode = body.mode === 'editing' ? 'editing' : 'viewing'
  upsertTaskPresence({ clientId, userId: user.id, taskId: task.id, mode })
  return NextResponse.json({ ok: true })
}
