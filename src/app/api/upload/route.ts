import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getSessionUser } from '@/lib/auth'
import { createAttachment, createActivityLog, getTaskById, recordBoardEvent } from '@/lib/local-data'
import { YORKI_DB_DIR } from '@/lib/db-config'
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, isTaskAssignedToUser } from '@/lib/utils'

export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const formData = await request.formData()
    const file     = formData.get('file')   as File   | null
    const taskId   = formData.get('task_id') as string | null

    if (!file)   return NextResponse.json({ error: 'No file'    }, { status: 400 })
    if (!taskId) return NextResponse.json({ error: 'No task_id' }, { status: 400 })

    const task = await getTaskById(taskId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const canUpload =
      user.role === 'admin' ||
      user.role === 'super_admin' ||
      task.submitted_by === user.id ||
      isTaskAssignedToUser(task, user.id)

    if (!canUpload) {
      return NextResponse.json({ error: 'You do not have permission to upload files to this task.' }, { status: 403 })
    }

    if (!ALLOWED_FILE_TYPES.includes(file.type))
      return NextResponse.json({ error: `File type not allowed: ${file.type}` }, { status: 415 })

    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 })

    // Save to a private uploads directory outside public/
    const uploadDir = path.join(YORKI_DB_DIR, 'uploads', taskId)
    await mkdir(uploadDir, { recursive: true })

    const ext      = path.extname(file.name)
    const safeName = `${randomUUID()}${ext}`
    const filePath = path.join(uploadDir, safeName)
    const buffer   = Buffer.from(await file.arrayBuffer())
    await writeFile(filePath, buffer)

    const attachmentId = randomUUID()
    const publicUrl   = `/api/attachments/${attachmentId}`
    const storagePath = filePath

    const attachment = await createAttachment({
      id: attachmentId,
      taskId, uploadedBy: user.id,
      fileName: file.name, fileSize: file.size,
      fileType: file.type, storagePath, publicUrl,
    })

    await createActivityLog({
      actor_id: user.id, task_id: taskId,
      entity_type: 'attachment', entity_id: attachment.id,
      action: 'attachment_added',
      metadata: { file_name: file.name, file_size: file.size },
    })
    recordBoardEvent({ taskId, actorId: user.id, type: 'attachment_added' })

    return NextResponse.json({ success: true, attachment })
  } catch (err) {
    console.error('[upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
