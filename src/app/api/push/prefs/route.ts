import { savePrefs } from '@/lib/push/server'
import { guard, json, readJson } from '@/lib/push/http'

export const dynamic = 'force-dynamic'

/** Body: any of { mention, comment, assigned, completed, show_preview } as true/false. */
export async function PUT(request: Request) {
  const checked = await guard(request, true)
  if ('response' in checked) return checked.response
  const read = await readJson(request)
  if (!read.ok) return read.response
  return json({ ok: true, prefs: savePrefs(checked.user.id, read.body) })
}
