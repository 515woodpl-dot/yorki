import { getPrefs, getVapid, listDevices } from '@/lib/push/server'
import { guard, json } from '@/lib/push/http'

export const dynamic = 'force-dynamic'

/** Everything the settings page needs: the public key to subscribe with, preferences, devices. */
export async function GET(request: Request) {
  const checked = await guard(request, false)
  if ('response' in checked) return checked.response
  const vapid = await getVapid()
  return json({ publicKey: vapid.publicKey, prefs: getPrefs(checked.user.id), devices: listDevices(checked.user.id) })
}
