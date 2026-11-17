import { sendTestPush } from '@/lib/push/server'
import { guard, json } from '@/lib/push/http'

export const dynamic = 'force-dynamic'

const lastTest = new Map<string, number>()
const MIN_GAP_MS = 10_000

/** "Send me a test notification." Rate-limited so it can't be used to spam a phone. */
export async function POST(request: Request) {
  const checked = await guard(request, true)
  if ('response' in checked) return checked.response
  const now = Date.now()
  if (now - (lastTest.get(checked.user.id) ?? 0) < MIN_GAP_MS) return json({ error: 'Please wait a few seconds between tests.' }, 429)
  lastTest.set(checked.user.id, now)
  const result = await sendTestPush(checked.user.id)
  if (result.devices === 0) return json({ error: 'No device has notifications turned on yet.', ...result }, 409)
  return json({ ok: result.sent > 0, ...result })
}
