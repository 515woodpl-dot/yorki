import { canSeeTask } from '@/lib/category-access'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { getAttachmentById, getTaskById, getCommentById } from '@/lib/local-data'
import { isTaskAssignedToUser } from '@/lib/utils'

function canAccessTask(user: { id: string; role: string }, task: { submitted_by: string; assigned_to: string | null }) {
  return user.role === 'admin'
    || user.role === 'super_admin'
    || task.submitted_by === user.id
    || isTaskAssignedToUser(task, user.id)
}

const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function buildContentDisposition(fileName: string, inline: boolean) {
  const disposition = inline ? 'inline' : 'attachment'
  const baseName = path.basename(fileName)
  const asciiFallback = baseName
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')

  const encodedName = encodeURIComponent(baseName)

  return `${disposition}; filename="${asciiFallback || 'file'}"; filename*=UTF-8''${encodedName}`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params
  const attachment = await getAttachmentById(attachmentId)
  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }

  const task = await getTaskById(attachment.task_id)
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const comment = attachment.comment_id ? await getCommentById(attachment.comment_id) : null
  if (attachment.comment_id && !comment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

  const token = request.nextUrl.searchParams.get('token')?.trim()
  const sessionUser = await getSessionUser()
  const hasSharedAccess =
    !!token && !attachment.comment_id &&
    task.status !== 'archived' &&
    !task.deleted_at &&
    typeof task.custom_fields?.share_token === 'string' &&
    task.custom_fields.share_token === token

  const hasSessionAccess = !!sessionUser && await canSeeTask(sessionUser, task) && canAccessTask(sessionUser, task) && (!comment?.is_internal || sessionUser.role !== 'staff')

  if (!hasSharedAccess && !hasSessionAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const file = await readFile(attachment.storage_path)
  const headers = new Headers()
  const inline = !!attachment.file_type && INLINE_TYPES.has(attachment.file_type)
  headers.set('Content-Type', inline && attachment.file_type ? attachment.file_type : 'application/octet-stream')
  headers.set('Content-Disposition', buildContentDisposition(attachment.file_name, inline))
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cache-Control', 'private, no-store, max-age=0')

  return new NextResponse(file, { headers })
}
