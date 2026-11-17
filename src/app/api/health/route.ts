import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    // Liveness must stay cheap as task volume grows. Full integrity checks
    // belong in the backup/restore procedure, not every public health request.
    getDb().prepare('SELECT 1').get()
    return NextResponse.json({ status: 'ok', time: new Date().toISOString() }, { headers })
  } catch (err) {
    console.error('[health] database unavailable', err)
    return NextResponse.json({ status: 'error' }, { status: 503, headers })
  }
}
