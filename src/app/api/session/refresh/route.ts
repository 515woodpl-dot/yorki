import { NextResponse } from 'next/server'
import { refreshSession } from '@/lib/auth'

export async function POST() {
  const refreshed = await refreshSession()
  return NextResponse.json(
    { refreshed },
    { status: refreshed ? 200 : 401, headers: { 'Cache-Control': 'no-store' } },
  )
}
