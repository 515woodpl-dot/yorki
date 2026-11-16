import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Must run on every request. Without this, Next.js pre-renders the response
// at build time and the health check reports "ok" forever, even when the
// database is broken.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const db = getDb()
    const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    const userCount = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n
    const taskCount = (db.prepare('SELECT COUNT(*) as n FROM tasks WHERE deleted_at IS NULL').get() as { n: number }).n

    const healthy = result.integrity_check === 'ok'
    return NextResponse.json({
      status: healthy ? 'ok' : 'error',
      integrity: result.integrity_check,
      users: userCount,
      tasks: taskCount,
      time: new Date().toISOString(),
    }, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      error: err instanceof Error ? err.message : 'Unknown',
    }, { status: 500 })
  }
}
