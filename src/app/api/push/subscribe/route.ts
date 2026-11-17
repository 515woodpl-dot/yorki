import { removeSubscription, saveSubscription } from '@/lib/push/server'
import { validateSubscriptionInput } from '@/lib/push/validate'
import { guard, json, readJson } from '@/lib/push/http'

export const dynamic = 'force-dynamic'

const extraHosts = () => (process.env.PUSH_EXTRA_HOSTS ?? '').split(',')

/** Body: the browser's PushSubscription.toJSON(). */
export async function POST(request: Request) {
  const checked = await guard(request, true)
  if ('response' in checked) return checked.response
  const read = await readJson(request)
  if (!read.ok) return read.response
  const input = validateSubscriptionInput(read.body, request.headers.get('user-agent'), extraHosts())
  if (!input.ok) return json({ error: input.error }, 400)
  return json({ ok: true, ...saveSubscription(checked.user.id, input.value) })
}

/** Body: { endpoint } or { id }. Only removes this person's own devices. */
export async function DELETE(request: Request) {
  const checked = await guard(request, true)
  if ('response' in checked) return checked.response
  const read = await readJson(request)
  if (!read.ok) return read.response
  const body = read.body as { endpoint?: unknown; id?: unknown }
  const target = typeof body.endpoint === 'string' ? body.endpoint : typeof body.id === 'string' ? body.id : ''
  if (!target || target.length > 1000) return json({ error: 'Nothing to remove.' }, 400)
  return json({ ok: true, removed: removeSubscription(checked.user.id, target) })
}
